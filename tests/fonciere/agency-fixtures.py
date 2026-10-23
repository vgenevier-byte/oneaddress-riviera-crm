"""Known fictional digital, scanned PDF and image inputs for real local OCR."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab import rl_config

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
rl_config.useA85 = 0
lines = [
    'Nom du bien : Projet Nuage Fictif',
    'Type de bien : Maison',
    'Reference : TEST-FONC001',
    'Adresse du bien : 12 rue des Nuages',
    'Ville : Ville Fictive',
    'Code postal : 00000',
    'Prix demande : 545 000 EUR',
    'Surface habitable : 123 m2',
    'Terrain : 456 m2',
    'Pieces : 5',
    'Chambres : 3',
    'Agence : Agence Fictive des Nuages',
    'Adresse agence : 99 avenue du Test, 00000 Cite Fictive',
    'Telephone agence : 01 23 45 67 89',
    'Email agence : agence@example.test',
    'Agent : Camille Fictive',
    'Telephone agent : 06 12 34 56 78',
    'Email agent : camille@example.test',
    'Description : Maison fictive avec jardin et garage.',
    'Potentiel annonce : Division a etudier sous reserve des autorisations.',
    'Piscine : Non',
    'DPE : D',
    'Charges annuelles : 1 200 EUR',
]
image = Image.new('RGB', (1654, 2339), 'white'); draw = ImageDraw.Draw(image)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 34)
for index, line in enumerate(lines): draw.text((75, 95 + index * 65), line, fill='black', font=font)
draw.rectangle((75, 1700, 1575, 2140), fill='#d6e9ef', outline='#507b8a', width=5)
draw.text((150, 1870), 'VISUEL FICTIF - AUCUN BIEN REEL', fill='black', font=font)
image.save(out/'fiche-ocr-fictive.png')
image.save(out/'fiche-ocr-fictive.jpg', quality=95)
c = canvas.Canvas(str(out/'fiche-scan-fictive.pdf'), pagesize=(595, 842), pageCompression=1)
c.setTitle('Fiche fictive OCR - aucune donnee reelle'); c.drawImage(ImageReader(image), 0, 0, width=595, height=842); c.showPage(); c.save()
c = canvas.Canvas(str(out/'fiche-texte-fictive.pdf'), pagesize=(595, 842), pageCompression=1)
c.setTitle('Fiche fictive texte - aucune donnee reelle'); c.setFont('Helvetica', 10)
for index, line in enumerate(lines): c.drawString(30, 805-index*25, line)
c.drawImage(ImageReader(image.crop((75,1700,1575,2140))), 30, 30, width=535, height=156.9); c.showPage(); c.save()
print('Four fictional agency inputs generated.')
