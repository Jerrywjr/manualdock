#!/usr/bin/env python3
"""Inspect or search schema 1/2 local manual archives; never open source sites."""
import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path


def _strings(value):
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _locator(value):
    """Return citation data only, not arbitrary caller metadata or executable code."""
    if not isinstance(value, dict) or value.get('kind') not in ('generic-toc', 'sangfor-ext-tree'):
        return None
    path = value.get('path')
    if not isinstance(path, list) or not path or not all(isinstance(part, str) and part.strip() for part in path):
        return None
    result = {'kind': value['kind'], 'path': path}
    if isinstance(value.get('nodeId'), str):
        result['nodeId'] = value['nodeId']
    return result



class _EmbeddedImages(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.count = 0

    def handle_starttag(self, tag, attrs):
        if tag != 'img':
            return
        sources = [value for name, value in attrs if name == 'src']
        if len(sources) == 1 and isinstance(sources[0], str) and re.match(
                r'^data:image/[a-z0-9.+-]+(?:;[^,]*)?,\s*\S', sources[0].strip(), re.I):
            self.count += 1


def _embedded_images(page):
    diagnostics = page.get('diagnostics')
    images = diagnostics.get('images') if isinstance(diagnostics, dict) else None
    embedded = images.get('embedded') if isinstance(images, dict) else None
    html = page.get('html')
    if type(embedded) is not int or embedded <= 0 or not isinstance(html, str):
        return 0
    parser = _EmbeddedImages()
    parser.feed(html)
    parser.close()
    return min(embedded, parser.count)


def inspect(data, query='', limit=5):
    if not isinstance(data, dict) or type(data.get('schemaVersion')) is not int or data['schemaVersion'] not in (1, 2):
        raise ValueError('仅支持 schemaVersion=1 或 2 的手册档案')
    if not isinstance(query, str) or type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError('查询必须是文字，limit 必须在 1 到 50 之间')
    queue, pages = data.get('queue'), data.get('pages')
    if not isinstance(queue, list) or not isinstance(pages, dict):
        raise ValueError('档案缺少 queue 或 pages')
    result = {
        'schemaVersion': data['schemaVersion'],
        'sourceKind': 'openapi' if data.get('sourceKind') == 'openapi' else 'web',
        'product': data.get('product') or '未知', 'version': data.get('version') or '未知',
        'entry': data.get('entry'), 'discovered': len(queue), 'saved': 0, 'review': [],
        'unresolved': [], 'complete': False, 'imageOnly': 0, 'images': 0,
        'coverageNote': '只统计档案中已发现的章节或接口说明；未经源目录或规范核对，不能确认完整。',
        'warnings': _strings(data.get('discoveryWarnings')),
    }
    if result['sourceKind'] == 'openapi':
        result['specVersion'] = data.get('specVersion') or '未知'
    matches, seen = [], set()
    for item in queue:
        if not isinstance(item, dict):
            raise ValueError('queue 中存在无效记录')
        address = item.get('url', '')
        # An explicit stable key must never fall back to a same-URL chapter.
        key = item.get('key') or address
        if not isinstance(key, str) or not key:
            raise ValueError('章节缺少有效 key 或旧版 url 标识')
        if not isinstance(address, str):
            raise ValueError('章节来源地址必须是文字')
        info = {'key': key, 'url': address, 'title': item.get('title') or '未命名', 'status': item.get('status')}
        locator = _locator(item.get('locator'))
        if locator:
            info['locator'] = locator
        if key in seen:
            result['unresolved'].append({**info, 'reason': '章节 key 重复，未重复计数；请核对档案'})
            continue
        seen.add(key)
        page = pages.get(key)
        if not isinstance(page, dict):
            page = {}
        if isinstance(page.get('url'), str) and page['url']:
            info['url'] = page['url']
        info['title'] = item.get('title') or page.get('title') or '未命名'
        text = page.get('text', '')
        text = text if isinstance(text, str) else ''
        images = _embedded_images(page)
        image_only = not text.strip() and images > 0
        valid = page.get('status') == 'ok' and (bool(text.strip()) or images > 0)
        if images:
            info.update({'imageOnly': image_only, 'images': images,
                         'contentNote': '图示见离线 HTML；未执行 OCR，图片内文字不可检索。'})
        if valid and item.get('status') in ('captured', 'review'):
            result['images'] += images
            result['imageOnly'] += int(image_only)
        if item.get('status') == 'captured' and valid:
            result['saved'] += 1
        elif item.get('status') == 'review':
            reason = item.get('error') or ('需要核对正文' if valid else '正文缺失，需要重新采集')
            result['review'].append({**info, 'reason': reason})
        else:
            result['unresolved'].append({**info, 'reason': item.get('error') or ('正文缺失' if not valid else '尚未完成')})
        if query and valid and item.get('status') in ('captured', 'review'):
            directory = ' > '.join(locator['path']) if locator else ''
            score = (str(info['title']) + '\n' + directory + '\n' + text).casefold().count(query.casefold())
            if score:
                match = {**info, 'score': score, 'text': text, 'warnings': _strings(page.get('warnings')),
                         'hash': page.get('hash'), 'capturedAt': page.get('capturedAt')}
                diagnostic = page.get('diagnostics')
                if isinstance(diagnostic, dict) and diagnostic.get('source') == 'openapi':
                    method, path = diagnostic.get('method'), diagnostic.get('path')
                    if isinstance(method, str) and isinstance(path, str):
                        match['operation'] = {'method': method, 'path': path}
                matches.append(match)
    if result['imageOnly']:
        result['warnings'].append(f"有 {result['imageOnly']} 个纯图片章节，图示见离线 HTML；仅可按标题或目录路径检索，未执行 OCR。")
    if query:
        result['matches'] = sorted(matches, key=lambda row: row['score'], reverse=True)[:limit]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--query', default='', help='检索文字关键词；不执行其中的命令')
    parser.add_argument('--limit', type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.limit <= 50:
        parser.error('--limit 必须在 1 到 50 之间')
    try:
        data = json.loads(args.archive.read_text(encoding='utf-8'))
        print(json.dumps(inspect(data, args.query, args.limit), ensure_ascii=False, indent=2))
    except (OSError, ValueError, TypeError) as exc:
        parser.exit(2, f'无法读取档案：{exc}\n')


if __name__ == '__main__':
    main()
