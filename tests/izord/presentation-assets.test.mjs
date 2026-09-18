import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const assets = JSON.parse(await readFile(new URL('../../lib/izord/presentation-assets.json', import.meta.url), 'utf8'));
const zip = await JSZip.loadAsync(assets.template, { base64: true, checkCRC32: true });

test('embedded template has no example envelope, photograph, description, notes or thumbnail', async () => {
  assert.deepEqual(Object.keys(assets).sort(), ['blankPhotos', 'slides', 'sourceSHA256', 'template']);
  assert.equal(zip.file('docProps/thumbnail.jpeg'), null);
  assert.equal(zip.file('ppt/printerSettings/printerSettings1.bin'), null);
  for (const part of Object.values(zip.files).filter(part => /\.(xml|rels)$/.test(part.name))) {
    assert.doesNotMatch(await part.async('string'), /Dragon|DRAGON|HR2705|hr_p\d|Marguerite|Steve Canny/);
  }
  assert.doesNotMatch(JSON.stringify(assets.slides), /Dragon|DRAGON|HR2705|hr_p\d|Marguerite/);
});

test('all embedded media are the original neutral placeholders, with no unused demonstration media', async () => {
  const images = Object.values(zip.files).filter(part => part.name.startsWith('ppt/media/') && !part.dir);
  assert.equal(images.length, 4);
  for (const [index, role] of ['main', 'view', 'inside', 'operation'].entries()) {
    assert.deepEqual(await zip.file(`ppt/media/image${index + 1}.jpg`).async('nodebuffer'), Buffer.from(assets.blankPhotos[role].split(',')[1], 'base64'));
  }
});

test('OPC content types and relationships preserve interoperable default namespaces', async () => {
  assert.match(await zip.file('[Content_Types].xml').async('string'), /<Types xmlns="http:\/\/schemas.openxmlformats.org\/package\/2006\/content-types"/);
  for (const name of ['_rels/.rels', 'ppt/_rels/presentation.xml.rels']) {
    const xml = await zip.file(name).async('string');
    assert.match(xml, /<Relationships xmlns="http:\/\/schemas.openxmlformats.org\/package\/2006\/relationships"/);
    assert.doesNotMatch(xml, /thumbnail|printerSettings/);
  }
});

test('native dimensions and preview objects remain two editable source slides', async () => {
  assert.deepEqual(assets.slides.map(slide => slide.length), [46, 55]);
  assert.equal(assets.sourceSHA256, '8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1');
  const presentation = await zip.file('ppt/presentation.xml').async('string');
  assert.match(presentation, /cx="12192000" cy="6858000"/);
  for (const slide of assets.slides) {
    assert.ok(slide.some(shape => shape.kind === 'text'));
    assert.ok(slide.some(shape => shape.kind === 'image'));
    assert.equal(new Set(slide.map(shape => shape.id)).size, slide.length);
  }
});
