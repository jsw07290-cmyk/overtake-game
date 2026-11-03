"""Build dependency-free, self-contained HTML editions, including the coin artwork."""
from pathlib import Path
import base64
import zipfile
root=Path(__file__).resolve().parents[1]
script=(root/'game.js').read_text()
for name in ['fly-portrait.png','tank-portrait.png']:
    asset=root/'assets'/name
    if not asset.exists():
        raise SystemExit(f'Missing artwork: {asset}')
    uri='data:image/png;base64,'+base64.b64encode(asset.read_bytes()).decode('ascii')
    script=script.replace('assets/'+name,uri)
html=(root/'index.html').read_text().replace('<link rel="stylesheet" href="style.css">','<style>\n'+(root/'style.css').read_text()+'\n</style>').replace('<script src="game.js"></script>','<script>\n'+script+'\n</script>')
(root/'REDLINE.html').write_text(html)
(root/'REDLINE-endless.html').write_text(html)
(root/'REDLINE-hard.html').write_text(html.replace('\n</script>',"\nselectMode('hard');\n</script>"))
with zipfile.ZipFile(root/'redline-dist.zip','w',zipfile.ZIP_DEFLATED) as z:
    for name in ['index.html','style.css','game.js','README.md','REDLINE.html','REDLINE-hard.html','assets/fly-portrait.png','assets/tank-portrait.png']:
        z.write(root/name,name)
print('Built standalone normal/hard endless editions with embedded coin artwork.')
