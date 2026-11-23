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
 def test_reject_unclear_package(self):
  self.assertEqual(k.parse_row(['10000','Магазин','Ориз български','X','1','2.00',''],'x.csv'),[])
if __name__=='__main__':unittest.main()
