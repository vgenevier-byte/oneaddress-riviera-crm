"""Only fictional generator inputs. No real property, person, location or business data."""
from pathlib import Path
from io import BytesIO
import sys
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab import rl_config

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
rl_config.useA85 = 0  # The audited worker supports embedded DCT JPEG, not mixed ASCII85 filters.
photo = Image.new('RGB', (900, 450), '#245466'); draw = ImageDraw.Draw(photo)
draw.rectangle((0, 0, 130, 450), fill='#d92c24')
draw.rectangle((770, 0, 899, 450), fill='#24bf30')
draw.rectangle((300, 160, 600, 290), fill='white')
draw.text((320, 210), 'FICTIF - FILIGRANE', fill='black', stroke_width=1)
photo.save(out/'photo-fictive.jpg', quality=95)
transparent = Image.new('RGBA', (400, 300), (0,0,0,0)); pd=ImageDraw.Draw(transparent)
pd.rectangle((100,75,300,225), fill=(250,180,20,255)); pd.text((120,140),'FICTIF',fill=(0,0,0,255))
transparent.save(out/'photo-fictive.png'); transparent.save(out/'photo-fictive.webp')

base = ['Type de bien : Maison', 'Ville', 'Ville Fictive', 'Code postal', '00000', 'Reference : FIX001', 'Surface habitable : 120 m2', 'Terrain : 500 m2', 'Prix : 500 000 EUR', 'Vue mer : Non', 'Chambres : 3']
def make(name, lines, image=True):
 c=canvas.Canvas(str(out/name), pagesize=(595,842), pageCompression=1)
 c.setTitle('Fixture IZORD - aucune donnee reelle'); c.setAuthor('Tests locaux IZORD')
 c.setFont('Helvetica-Bold',17); c.drawString(40,795,'FIXTURE FICTIVE - PAS UN BIEN REEL')
 c.setFont('Helvetica',12)
 for i,line in enumerate(lines): c.drawString(40,755-i*18,line)
 if image: c.drawImage(str(out/'photo-fictive.jpg'),40,130,width=515,height=257.5)
 c.showPage(); c.save()
make('fiche-numerique-fictive.pdf',base)
make('fiche-distincte-fictive.pdf',[line.replace('Maison','Appartement').replace('FIX001','FIX002').replace('500 000','250 000').replace('120 m2','70 m2') for line in base])
make('fiche-incomplete-fictive.pdf',['Description fictive volontairement incomplete. Aucun prix ni surface renseignes.'],False)
c=canvas.Canvas(str(out/'scan-fictif-sans-texte.pdf'),pagesize=(595,842),pageCompression=1)
c.setTitle('Fixture scan fictif sans OCR'); c.setAuthor('Tests locaux IZORD')
c.drawImage(str(out/'photo-fictive.jpg'),40,240,width=515,height=257.5); c.showPage(); c.save()
print('4 PDF et 3 images entierement fictifs crees.')
