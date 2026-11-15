/**
 * Makes the small fixture files the parsers' tests read: `node make.mjs`.
 *
 *   handout.docx   headings, a paragraph with an equation as typed text, a list
 *   equations.docx Word equations (OMML): a quadratic formula, a sum, a matrix, a limit, a vector
 *   slides.pptx    three slides: title and bullets with notes, text with notes, a picture only
 *   scan.pdf       page 1 has a text layer, page 2 is only a picture (a scan)
 *   page.png       the picture used by the picture-only slide and page
 *
 * They are built from XML and a browser print, not copied from anywhere, and they are
 * committed so the tests need neither a browser nor this script.
 */
import { chromium } from '@playwright/test';
import JSZip from 'jszip';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function docx() {
	const p = (text, style) =>
		`<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
	const body = [
		p('Lineární rovnice', 'Heading1'),
		p('Lineární rovnice je rovnice, ve které se neznámá vyskytuje jen v první mocnině.'),
		p('Řešení krok za krokem', 'Heading2'),
		p('Příklad: x + 5 = 12'),
		p('Od obou stran odečteme 5, tedy x = 12 - 5 = 7.'),
		p('Zkouška', 'Heading2'),
		p('Dosadíme 7 za x: 7 + 5 = 12, rovnost platí.')
	].join('');
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
	);
	zip.file(
		'_rels/.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="word/document.xml"/></Relationships>`
	);
	zip.file(
		'word/_rels/document.xml.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${DOC_REL}/styles" Target="styles.xml"/></Relationships>`
	);
	const style = (id, name) =>
		`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
	zip.file(
		'word/styles.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${NS_W}">${style('Heading1', 'heading 1')}${style('Heading2', 'heading 2')}</w:styles>`
	);
	zip.file(
		'word/document.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${NS_W}"><w:body>${body}</w:body></w:document>`
	);
	await writeFile(join(here, 'handout.docx'), await zip.generateAsync({ type: 'nodebuffer' }));
}

/** A Word file whose equations are OMML, the way Word's equation editor writes them. */
async function equations() {
	const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
	const r = (t) => `<m:r><m:t>${esc(t)}</m:t></m:r>`;
	const e = (x) => `<m:e>${x}</m:e>`;
	const frac = (n, d) => `<m:f><m:num>${n}</m:num><m:den>${d}</m:den></m:f>`;
	const sup = (b, s) => `<m:sSup>${e(b)}<m:sup>${s}</m:sup></m:sSup>`;
	const quadratic =
		r('x=') +
		frac(
			r('−b±') +
				`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(sup(r('b'), r('2')) + r('−4ac'))}</m:rad>`,
			r('2a')
		);
	const sum =
		`<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r('i=1')}</m:sub><m:sup>${r('n')}</m:sup>${e(r('i'))}</m:nary>` +
		r('=') +
		frac(r('n') + `<m:d>${e(r('n+1'))}</m:d>`, r('2'));
	const matrix = `<m:d>${e(
		`<m:m><m:mr>${e(r('1'))}${e(r('2'))}</m:mr><m:mr>${e(r('3'))}${e(r('4'))}</m:mr></m:m>`
	)}</m:d>`;
	const limit =
		`<m:func><m:fName><m:limLow>${e(r('lim'))}<m:lim>${r('x→0')}</m:lim></m:limLow></m:fName>${e(frac(`<m:func><m:fName>${r('sin')}</m:fName>${e(r('x'))}</m:func>`, r('x')))}</m:func>` +
		r('=1');
	const vector =
		`<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr>${e(r('v'))}</m:acc>` +
		r('·') +
		r('w') +
		r('≤') +
		r('π');
	const para = (math) => `<w:p><m:oMathPara><m:oMath>${math}</m:oMath></m:oMathPara></w:p>`;
	const inline = (before, math, after) =>
		`<w:p><w:r><w:t xml:space="preserve">${esc(before)}</w:t></w:r><m:oMath>${math}</m:oMath><w:r><w:t xml:space="preserve">${esc(after)}</w:t></w:r></w:p>`;
	const p = (t, style) =>
		`<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
	const body = [
		p('Vzorce', 'Heading1'),
		p('Kvadratická rovnice se řeší vzorcem:'),
		para(quadratic),
		inline('Součet prvních čísel: ', sum, ' pro každé n.'),
		p('Matice', 'Heading2'),
		para(matrix),
		para(limit),
		inline('Skalární součin ', vector, ' je číslo.')
	].join('');
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
	);
	zip.file(
		'_rels/.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="word/document.xml"/></Relationships>`
	);
	zip.file(
		'word/_rels/document.xml.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${DOC_REL}/styles" Target="styles.xml"/></Relationships>`
	);
	const style = (id, name) =>
		`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
	zip.file(
		'word/styles.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${NS_W}">${style('Heading1', 'heading 1')}${style('Heading2', 'heading 2')}</w:styles>`
	);
	zip.file(
		'word/document.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${NS_W}" xmlns:m="${M}"><w:body>${body}</w:body></w:document>`
	);
	await writeFile(join(here, 'equations.docx'), await zip.generateAsync({ type: 'nodebuffer' }));
}

async function png(browser) {
	const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
	await page.setContent(
		`<body style="margin:0;background:#fff"><div style="font:italic 28px sans-serif;padding:24px;transform:rotate(-3deg)">2x + 3 = 11<br>x = 4</div></body>`
	);
	const bytes = await page.screenshot({ type: 'png' });
	await page.close();
	await writeFile(join(here, 'page.png'), bytes);
	return bytes;
}

async function pptx(picture) {
	const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
	const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
	const R = DOC_REL;
	const sp = (type, id, paragraphs) =>
		`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s${id}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paragraphs
			.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`)
			.join('')}</p:txBody></p:sp>`;
	const slide = (shapes) =>
		`<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
	const notes = (text) =>
		`<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:a="${A}" xmlns:p="${P}"><p:cSld><p:spTree>${sp('sldImg', 1, [])}${sp('body', 2, [text])}${sp('sldNum', 3, ['1'])}</p:spTree></p:cSld></p:notes>`;
	const rels = (items) =>
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}">${items
			.map(
				([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`
			)
			.join('')}</Relationships>`;
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>`
	);
	zip.file('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]));
	// The deck lists the slides in the order 2, 1, 3, so that file order and deck order differ.
	zip.file(
		'ppt/presentation.xml',
		`<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst></p:presentation>`
	);
	zip.file(
		'ppt/_rels/presentation.xml.rels',
		rels([
			['rId1', 'slide', 'slides/slide1.xml'],
			['rId2', 'slide', 'slides/slide2.xml'],
			['rId3', 'slide', 'slides/slide3.xml']
		])
	);
	zip.file(
		'ppt/slides/slide1.xml',
		slide(
			sp('title', 2, ['Zlomky & čísla']) +
				sp('body', 3, ['Čitatel nad čarou', 'Jmenovatel pod čarou'])
		)
	);
	zip.file(
		'ppt/slides/_rels/slide1.xml.rels',
		rels([['rId1', 'notesSlide', '../notesSlides/notesSlide1.xml']])
	);
	zip.file('ppt/notesSlides/notesSlide1.xml', notes('Zdůrazni, že jmenovatel nesmí být nula.'));
	zip.file(
		'ppt/slides/slide2.xml',
		slide(sp('title', 2, ['Úvod']) + sp('body', 3, ['Dnes se naučíme zlomky.']))
	);
	zip.file(
		'ppt/slides/_rels/slide2.xml.rels',
		rels([['rId1', 'notesSlide', '../notesSlides/notesSlide2.xml']])
	);
	zip.file('ppt/notesSlides/notesSlide2.xml', notes('Začni příkladem s pizzou.'));
	zip.file(
		'ppt/slides/slide3.xml',
		slide(
			`<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/></p:blipFill><p:spPr/></p:pic>`
		)
	);
	zip.file('ppt/slides/_rels/slide3.xml.rels', rels([['rId1', 'image', '../media/image1.png']]));
	zip.file('ppt/media/image1.png', picture);
	await writeFile(join(here, 'slides.pptx'), await zip.generateAsync({ type: 'nodebuffer' }));
}

async function pdf(browser, picture) {
	const page = await browser.newPage();
	const src = `data:image/png;base64,${picture.toString('base64')}`;
	await page.setContent(
		`<body style="font:16px sans-serif"><h1>Strana s textem</h1><p>Sčítání zlomků se stejným jmenovatelem: sečteme čitatele a jmenovatel opíšeme.</p><div style="break-after:page"></div><img src="${src}" style="width:100%"></body>`
	);
	await writeFile(join(here, 'scan.pdf'), await page.pdf({ format: 'A5' }));
	await page.close();
}

const browser = await chromium.launch();
const picture = await png(browser);
await docx();
await equations();
await pptx(picture);
await pdf(browser, picture);
await browser.close();
