/** Afișează URL-ul pentru Releases din package.json (build.publish). Folosit de build-release.bat. */
const path = require('path');
const pkg = require(path.join(__dirname, '..', 'package.json'));
const pub = pkg.build && pkg.build.publish;
if (pub && pub.owner && pub.repo) {
  console.log('https://github.com/' + pub.owner + '/' + pub.repo + '/releases/new');
}
