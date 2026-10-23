"""Reads an .xlsx with the standard library only: python3 -I xl.py <file.xlsx> <out.json>
Writes {sheet name: [[cell, ...], ...]} with the cell text (shared strings resolved, formulas as their cached value)."""
import json, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
RNS = '{http://schemas.openxmlformats.org/package/2006/relationships}'

def col(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1

def main(src, out):
    z = zipfile.ZipFile(src)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels')).findall(RNS + 'Relationship')}
    result = {}
    for sh in wb.find('m:sheets', NS).findall('m:sheet', NS):
        target = rels[sh.get('{%s}id' % NS['r'])]
        path = 'xl/' + target.lstrip('/').replace('xl/', '') if not target.startswith('/') else target.lstrip('/')
        rows = []
        for row in ET.fromstring(z.read(path)).iter('{%s}row' % NS['m']):
            cells = {}
            for c in row.findall('m:c', NS):
                t = c.get('t'); v = c.find('m:v', NS)
                if t == 's' and v is not None: text = shared[int(v.text)]
                elif t == 'inlineStr': text = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
                elif v is not None: text = v.text or ''
                else: text = ''
                if text != '': cells[col(c.get('r'))] = text
            if cells:
                r = [''] * (max(cells) + 1)
                for k, v in cells.items(): r[k] = v
                rows.append(r)
        result[sh.get('name')] = rows
    json.dump(result, open(out, 'w'), ensure_ascii=False, indent=0)
    for name, rows in result.items():
        print(f'{len(rows):3d} rows  {name}')

main(sys.argv[1], sys.argv[2])
