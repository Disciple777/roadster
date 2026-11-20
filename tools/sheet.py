# Contact sheet of the six renders finish() writes with --renders DIR: python tools/sheet.py DIR -> DIR/sheet.jpg
from PIL import Image
import sys
d=sys.argv[1]
ims=[Image.open(d+'/'+n+'.png').convert('RGB') for n in ['front34','rear34','side','front','rear','top']]
W,H=ims[0].size; s=Image.new('RGB',(W*2,H*3))
for i,im in enumerate(ims): s.paste(im,((i%2)*W,(i//2)*H))
s.resize((W,int(H*1.5))).save(d+'/sheet.jpg',quality=88)
