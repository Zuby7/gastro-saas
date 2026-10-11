# Dish photo attribution

The dish photos in this directory are demo/seed data (`supabase/seed.sql` + `supabase/seed-assets/upload-dish-media.mjs`), also shown in marketing screenshots of the demo restaurant.

Ten photos come from Unsplash. The [Unsplash License](https://unsplash.com/license) allows free commercial use without attribution; the photographers are credited here anyway. Two photos (minestrone, acqua minerale) remain from Wikimedia Commons under the CC licenses listed below and require attribution. Do not use these two in marketing material without crediting them.

## Unsplash (no attribution required)

| File                   | Source                                              | Photographer            |
| ---------------------- | --------------------------------------------------- | ----------------------- |
| `bruschetta.jpg`       | [Unsplash](https://unsplash.com/photos/l1i4dlTN6Jg) | Douglas Lopez           |
| `caprese.jpg`          | [Unsplash](https://unsplash.com/photos/vJ-qtXoD-V8) | Brelyn Bashrum          |
| `lasagne.jpg`          | [Unsplash](https://unsplash.com/photos/f5hCsmthZ1I) | Cosmin Ursea            |
| `pizza-margherita.jpg` | [Unsplash](https://unsplash.com/photos/XIcLJbzoj2Q) | Diego Arenas de Rodrigo |
| `pizza-salami.jpg`     | [Unsplash](https://unsplash.com/photos/snG-LE3epJ8) | Ege Mese                |
| `risotto.jpg`          | [Unsplash](https://unsplash.com/photos/qIPRTMulc-g) | Julien Pianetti         |
| `carbonara.jpg`        | [Unsplash](https://unsplash.com/photos/t3B9LxHcybc) | Stoetzer Balazs         |
| `pannacotta.jpg`       | [Unsplash](https://unsplash.com/photos/lK1Q5RyD6tc) | Karly Gomez             |
| `tiramisu.jpg`         | [Unsplash](https://unsplash.com/photos/n3GkbNzur3s) | Olga Petnyunene         |
| `limonade.jpg`         | [Unsplash](https://unsplash.com/photos/lo_udD1o_lk) | Melissa Walker Horn     |

Re-encoded to about 1000 px width (JPEG quality 72) to stay well under the 5 MiB `media_assets.size_bytes` limit.

## Wikimedia Commons (attribution required)

| File                 | Source                                                                                        | Author                                 | License      |
| -------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- | ------------ |
| `minestrone.jpg`     | [Commons](https://commons.wikimedia.org/wiki/File:Minestrone_soup.jpg)                        | Katrin Morenz from Aachen, Deutschland | CC BY-SA 2.0 |
| `acqua-minerale.jpg` | [Commons](https://commons.wikimedia.org/wiki/File:Sparkling_Water_with_Mint_in_Glass_Cup.jpg) | Tony Webster                           | CC BY 2.0    |
