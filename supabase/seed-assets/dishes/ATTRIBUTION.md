# Dish photo attribution

All images in this directory are real dish photos sourced from Wikimedia
Commons (`commons.wikimedia.org`), downloaded via each file's stable
`Special:FilePath` redirect. Used here as local-dev/demo seed data only
(`supabase/seed.sql` + `supabase/seed-assets/upload-dish-media.mjs`) — never
served as production content. All licenses are free/permissive
(CC0/CC BY/CC BY-SA); attribution below per Commons' own license terms.

| File                   | Source                                                                                                          | Author                                 | License      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------ |
| `bruschetta.jpg`       | [Commons](https://commons.wikimedia.org/wiki/File:Bruschetta_at_The_Bar_at_MacArthur_Place_-_Sarah_Stierch.jpg) | Missvain                               | CC BY 4.0    |
| `caprese.jpg`          | [Commons](<https://commons.wikimedia.org/wiki/File:Insalata_Caprese_(from_Poznan).JPG>)                         | MOs810                                 | CC BY-SA 3.0 |
| `minestrone.jpg`       | [Commons](https://commons.wikimedia.org/wiki/File:Minestrone_soup.jpg)                                          | Katrin Morenz from Aachen, Deutschland | CC BY-SA 2.0 |
| `pizza-margherita.jpg` | [Commons](https://commons.wikimedia.org/wiki/File:Pizza-3007395.jpg)                                            | igorovsyannykov                        | CC0          |
| `pizza-salami.jpg`     | [Commons](<https://commons.wikimedia.org/wiki/File:Pizza_Salami_(23216232405).jpg>)                             | www.snack-nieuws.nl                    | CC BY 2.0    |
| `carbonara.jpg`        | [Commons](https://commons.wikimedia.org/wiki/File:Espaguetis_carbonara.jpg)                                     | Javier Somoza                          | CC BY-SA 4.0 |
| `lasagne.jpg`          | [Commons](https://commons.wikimedia.org/wiki/File:Lasagne_piece.jpg)                                            | Donna Alvita                           | CC BY-SA 4.0 |
| `risotto.jpg`          | [Commons](https://commons.wikimedia.org/wiki/File:Risotto_ai_funghi_porcini.JPG)                                | Number55                               | CC BY-SA 3.0 |
| `tiramisu.jpg`         | [Commons](<https://commons.wikimedia.org/wiki/File:Classic_Italian_Tiramisu-3_(29989504485).jpg>)               | Sharon Chen from Austin, United States | CC BY 2.0    |
| `pannacotta.jpg`       | [Commons](https://commons.wikimedia.org/wiki/File:Panna_Cotta_with_caramel_sauce.jpg)                           | Toben                                  | CC BY-SA 4.0 |
| `acqua-minerale.jpg`   | [Commons](https://commons.wikimedia.org/wiki/File:Sparkling_Water_with_Mint_in_Glass_Cup.jpg)                   | Tony Webster                           | CC BY 2.0    |
| `limonade.jpg`         | [Commons](https://commons.wikimedia.org/wiki/File:Homemade_lemonade_at_restaurant_Visums,_Riga.jpg)             | JIP                                    | CC BY-SA 4.0 |

All files re-encoded to ~800px width via Commons' own thumbnailing
(`?width=800` on the `Special:FilePath` redirect) to keep each file well
under `media_assets.size_bytes`'s 5 MiB check constraint.
