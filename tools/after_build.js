'use strict';

/*
 * electron-builder `afterAllArtifactBuild` 훅.
 *
 * GitHub Actions 워크플로가 릴리스에 `dist/*.exe`만 올리기 때문에, 자동 업데이트가 읽는
 * `latest.yml`이 릴리스에 빠지는 일이 있다. 이 훅은 빌드가 끝난 뒤
 *   1) `dist/latest.yml`을 직접 만들고,
 *   2) 그 내용과 파일별 sha512를 빌드 로그에 남긴다.
 * 그래서 latest.yml이 빠져도 로그에서 그대로 꺼내 릴리스에 붙일 수 있다.
 *
 * 실패해도 빌드 자체를 깨지 않도록 모든 예외를 삼킨다.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha512(file) {
  const hash = crypto.createHash('sha512');
  const buf = fs.readFileSync(file);
  hash.update(buf);
  return { digest: hash.digest('base64'), size: buf.length };
}

module.exports = async function afterAllArtifactBuild(buildResult) {
  try {
    const projectDir = path.join(__dirname, '..');
    const outDir = path.resolve((buildResult && buildResult.outDir) || path.join(projectDir, 'dist'));
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    const version = pkg.version;

    const files = fs.readdirSync(outDir)
      .filter((name) => /\.exe$/i.test(name) && name.includes(version))
      .sort((a, b) => (a.includes('setup') ? -1 : b.includes('setup') ? 1 : a.localeCompare(b)));

    if (!files.length) {
      console.log('[latest.yml] 빌드된 exe를 찾지 못했어요:', outDir);
      return [];
    }

    const entries = files.map((name) => {
      const { digest, size } = sha512(path.join(outDir, name));
      return { url: name, sha512: digest, size };
    });
    const primary = entries[0];

    const lines = [
      `version: ${version}`,
      'files:'
    ];
    for (const e of entries) {
      lines.push(`  - url: ${e.url}`);
      lines.push(`    sha512: ${e.sha512}`);
      lines.push(`    size: ${e.size}`);
    }
    lines.push(`path: ${primary.url}`);
    lines.push(`sha512: ${primary.sha512}`);
    lines.push(`releaseDate: '${new Date().toISOString()}'`);

    const yml = lines.join('\n') + '\n';
    const target = path.join(outDir, 'latest.yml');
    fs.writeFileSync(target, yml);

    console.log('[latest.yml] 작성:', target);
    console.log('-----BOTHOUSE_LATEST_YML_BEGIN-----');
    console.log(yml.trimEnd());
    console.log('-----BOTHOUSE_LATEST_YML_END-----');
    return [];
  } catch (err) {
    console.log('[latest.yml] 훅에서 문제가 생겼어요:', err && err.message);
    return [];
  }
};
