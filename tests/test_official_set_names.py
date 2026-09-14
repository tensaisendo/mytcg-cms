import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('audit', Path(__file__).resolve().parents[1] / 'scripts/audit-official-set-names.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class OfficialNames(unittest.TestCase):
    def test_compound_code(self):
        self.assertEqual(audit.identity("BOOSTER -AVENTURE SUR L'ÎLE DE DIEU- [OP15-EB04]"), ('OP15-EB04', "AVENTURE SUR L'ÎLE DE DIEU"))

    def test_deck_category(self):
        self.assertEqual(audit.identity('DECK POUR DÉMARRAGE -VERT/JAUNE Yamato- [ST-28]'), ('ST28', 'VERT/JAUNE Yamato'))

    def test_ex_category(self):
        self.assertEqual(audit.identity('DECK POUR DÉBUTANT EX -GEAR 5TH- [ST-21]'), ('ST21', 'GEAR 5TH'))

    def test_unknown(self):
        self.assertIsNone(audit.identity('Carte promo'))

    def test_html_entities(self):
        parser = audit.Products()
        parser.feed('<h4 class="linkListColTitle">A &amp; B [ST-01]</h4>')
        self.assertEqual(parser.titles, ['A & B [ST-01]'])


if __name__ == '__main__':
    unittest.main()
