import io
import csv
import zipfile
import unittest
import sync_kzp as k
class TestArchive(unittest.TestCase):
 def test_sample(self):
  data=io.BytesIO()
  with zipfile.ZipFile(data,'w') as zip:
   body=io.StringIO();writer=csv.writer(body)
   writer.writerow(['ЕКАТТЕ','Магазин','Наименование','Код','Категория','Цена','Промо цена'])
   writer.writerow(['10000','Магазин А','Ориз български 1 кг','R1','1','3.20','2.80'])
   writer.writerow(['10000','Магазин Б','Моцарела 125 г','M1','1','1.80',''])
   writer.writerow(['10000','Магазин Б','Картофено пюре 1 кг','K1','1','2.50',''])
   zip.writestr('retailer.csv',body.getvalue().encode('utf-8-sig'))
  grouped,qty=k.read_archive(data.getvalue())
  self.assertEqual(qty,1)
  self.assertEqual(grouped['RICE'][0]['price'],2.80)
  self.assertEqual(grouped['MOZZ'][0]['qty'],125)
  self.assertNotIn('POTATO',grouped)
  self.assertEqual(k.parse_row(['10000','Магазин','БИО ПЮРЕ СПАГЕТИ ДОМАТИ И МОЦАРЕЛА 220Г','M2','1','2.05',''],'x.csv'),[])
  self.assertEqual(k.parse_row(['10000','Магазин','Пълнозърнест хляб с моркови 500гр','C2','1','2.50',''],'x.csv'),[])
  self.assertEqual(k.parse_row(['10000','Магазин','130Г БИСКВИТИ С КРАВЕ МАСЛО','B1','1','1.20',''],'x.csv'),[])
  meat=k.parse_row(['10000','Магазин','~3КГ ПИЛЕШКО ФИЛЕ ОХЛАДЕНО','F1','1','6.05',''],'x.csv')
  self.assertEqual(meat[0][1]['qty'],1000)
  self.assertEqual(meat[0][1]['price'],6.05)
  for title in ['БАНИЦА ВИТА С МАЯ 180ГР', '130Г ОБИКН.БИСКВ.С КРАВЕ МАСЛО', 'МАСЛИНИ ЗЕЛЕНИ С ЧУШКА 4КГ', 'СВИНСКО ФИЛЕ ЖАРЕНО 1КГ']:
   self.assertEqual(k.parse_row(['10000','Магазин',title,'X','1','6.05',''],'x.csv'),[],title)
  meat2=k.parse_row(['10000','Магазин','Пилешко филе около 2кг','F2','1','5.29',''],'x.csv')
  self.assertEqual(meat2[0][1]['qty'],1000)
 def test_reject_unclear_package(self):
  self.assertEqual(k.parse_row(['10000','Магазин','Ориз български','X','1','2.00',''],'x.csv'),[])
if __name__=='__main__':unittest.main()
