/**
 * Demo content for the live app (people, cars, spots, clans, events, chats). Everything here is made up.
 * Every demo account uses an email ending in DEMO_EMAIL_DOMAIN, which is how removeDemo finds it.
 * Times are "days ago" / "days ahead" relative to the moment the seeder runs.
 */
import type { MOD_CATEGORIES } from '../db/schema.js';

export const DEMO_EMAIL_DOMAIN = 'demo.yolchu.az';

export type ClanTag = 'DMK' | 'A4X' | 'QFY' | 'NIVA';
type Cat = (typeof MOD_CATEGORIES)[number];
export type DemoMod = { name: string; category: Cat; price: number | null; private?: boolean; currency?: 'AZN' | 'USD' };
export type DemoCar = {
  make: string;
  model: string;
  year: number;
  trim?: string;
  engine?: string;
  engineL?: number;
  hp?: number;
  transmission?: 'manual' | 'automatic';
  fuel?: 'petrol' | 'diesel';
  /** colour name as an owner would type it (az) */
  color: string;
  description?: string;
  /** body style for the generated photo */
  body?: 'suv' | 'pickup' | 'small';
  photo?: boolean;
  mods?: DemoMod[];
};
export type DemoUser = {
  slug: string;
  name: string;
  display: string;
  city: string;
  bio: string;
  /** account created this many days ago */
  since: number;
  clan?: ClanTag;
  role?: 'leader' | 'officer' | 'member';
  /** joined the clan this many days ago (< 30 = rookie) */
  joined?: number;
  avatar?: boolean;
  cars: DemoCar[];
};

const m = (name: string, category: Cat, price: number | null, priv = false, currency: 'AZN' | 'USD' = 'AZN'): DemoMod => ({
  name,
  category,
  price,
  private: priv,
  currency,
});

export const COLOR_HEX: Record<string, string> = {
  Ağ: '#EDEDE8',
  'Mirvari ağ': '#F3F0E6',
  Qara: '#1E1E1E',
  Gümüşü: '#B9BDC1',
  Boz: '#7A7F84',
  'Tünd boz': '#4A4E52',
  Qırmızı: '#B3261E',
  Yaşıl: '#3E5B3A',
  'Haki yaşıl': '#6B6B3E',
  Sarı: '#E2B321',
  Mavi: '#2A4F7A',
  Bej: '#C8B48E',
  Qəhvəyi: '#6A4A32',
  Narıncı: '#D9661F',
};

export const USERS: DemoUser[] = [
  // ---------------- Dəmir Karvan (DMK) ----------------
  {
    slug: 'reshad.mammadov', name: 'Rəşad Məmmədov', display: 'Rəşad M.', city: 'Bakı', since: 160, clan: 'DMK', role: 'leader', joined: 140, avatar: true,
    bio: 'Dəmir Karvanın başçısı. 12 ildir dağ yollarındayam. Xızı və Şahdağ mənim ikinci evimdir.',
    cars: [
      {
        make: 'Toyota', model: 'Land Cruiser', year: 2014, trim: 'toyota-lc200-45d-272', color: 'Ağ', photo: true,
        description: 'Əsas ekspedisiya maşını. Hər həftəsonu dağdadır.',
        mods: [
          m('Old Man Emu 2" lift dəsti', 'lift', 3800),
          m('BFGoodrich KO2 285/70R17 (4 ədəd)', 'tyres', 3600, true),
          m('Warn Zeon 10-S bucurqad', 'recovery', 2900, true),
          m('Safari snorkel', 'engine', 650),
          m('ARB polad ön bamper', 'bumpers', 3400),
          m('Front Runner dam bagajı', 'roof', 2100),
        ],
      },
      {
        make: 'Toyota', model: 'Hilux', year: 2016, trim: 'toyota-hilux8-24d', color: 'Gümüşü', body: 'pickup', photo: true,
        description: 'Düşərgə yükü üçün pikap.',
      },
    ],
  },
  {
    slug: 'elnur.aliyev', name: 'Elnur Əliyev', display: 'Elnur Əliyev', city: 'Sumqayıt', since: 150, clan: 'DMK', role: 'officer', joined: 135, avatar: true,
    bio: 'Bələdçi. Marşrutları mən çəkirəm, siz sadəcə arxamca gəlin 🙂',
    cars: [
      {
        make: 'Nissan', model: 'Patrol', year: 2016, trim: 'nissan-patrol-y62-56', color: 'Qara', photo: true,
        mods: [
          m('Tough Dog 3" lift', 'lift', 4200, true),
          m('Maxxis Razr MT 305/70R18', 'tyres', 4800, true),
          m('Rock slider (yan qoruyucular)', 'armour', 1300),
          m('ARB arxa diferensial kilidi', 'other', 3200),
          m('Rigid LED fənərlər', 'lighting', null),
        ],
      },
      { make: 'Lada', model: 'Niva Legend', year: 2022, trim: 'lada-niva-legend-17', color: 'Haki yaşıl', body: 'small', photo: true, description: 'Ov və balıq üçün kiçik qardaş.' },
    ],
  },
  {
    slug: 'leyla.rzayeva', name: 'Leyla Rzayeva', display: 'Leyla R.', city: 'Bakı', since: 120, clan: 'DMK', role: 'member', joined: 100, avatar: true,
    bio: 'Fotoqrafam, dağlara kadr üçün gedirəm. GX ilə hər yerə çatıram.',
    cars: [
      {
        make: 'Lexus', model: 'GX', year: 2017, trim: 'lexus-gx460', color: 'Gümüşü', photo: true,
        mods: [m('Toyo Open Country A/T III', 'tyres', 2900), m('Dam bagajı + işıq', 'roof', 1650, true)],
      },
    ],
  },
  {
    slug: 'vuqar.safarov', name: 'Vüqar Səfərov', display: 'Vüqar S.', city: 'Şamaxı', since: 140, clan: 'DMK', role: 'member', joined: 110,
    bio: 'Şamaxı meşələrini əzbər bilirəm. Pirquluya yol göstərmək mənlikdir.',
    cars: [
      {
        make: 'Toyota', model: 'Land Cruiser Prado', year: 2012, trim: 'toyota-prado150-27', color: 'Bej', photo: true,
        mods: [m('Ironman 2" lift', 'lift', 2600, true), m('General Grabber AT3', 'tyres', 2700), m('Arxa pilləkən + təkər yeri', 'other', 900)],
      },
    ],
  },
  {
    slug: 'cavid.bagirov', name: 'Cavid Bağırov', display: 'Cavid B.', city: 'Bakı', since: 110, clan: 'DMK', role: 'member', joined: 90, avatar: true,
    bio: 'Yeni Defender, köhnə həvəs. Həftəsonları şəhərdən qaçıram.',
    cars: [
      {
        make: 'Land Rover', model: 'Defender', year: 2022, trim: 'lr-defender-l663-d300', color: 'Tünd boz', photo: true,
        mods: [m('Expedition dam bagajı', 'roof', 3200), m('Hava girişi (snorkel)', 'engine', 1100), m('Goodyear Wrangler DuraTrac', 'tyres', 3900, true)],
      },
      { make: 'Suzuki', model: 'Jimny', year: 2020, trim: 'suzuki-jimny-jb74', color: 'Sarı', body: 'small', photo: false },
    ],
  },
  {
    slug: 'murad.kazimov', name: 'Murad Kazımov', display: 'Murad Kazımov', city: 'Bakı', since: 95, clan: 'DMK', role: 'member', joined: 70,
    bio: 'LC300 ilə yeni başlamışam, amma sürətlə öyrənirəm.',
    cars: [
      { make: 'Toyota', model: 'Land Cruiser', year: 2023, trim: 'toyota-lc300-35', color: 'Mirvari ağ', photo: true, mods: [m('Polad karter qoruyucusu', 'armour', 1450)] },
      { make: 'Lexus', model: 'LX', year: 2022, trim: 'lexus-lx600', color: 'Qara', photo: false },
    ],
  },
  {
    slug: 'ilkin.zeynalov', name: 'İlkin Zeynalov', display: 'İlkin Z.', city: 'Bakı', since: 100, clan: 'DMK', role: 'member', joined: 60,
    bio: 'Discovery ilə ailəvi səfərlər. Uşaqlar çadırda yatmağı sevir.',
    cars: [{ make: 'Land Rover', model: 'Discovery', year: 2018, trim: 'lr-discovery5-sdv6', color: 'Mavi', photo: true }],
  },
  {
    slug: 'ulvi.rahimov', name: 'Ülvi Rəhimov', display: 'Ülvi R.', city: 'Bakı', since: 25, clan: 'DMK', role: 'member', joined: 12,
    bio: 'Klana yeni qoşulmuşam. Pajero Sport ilə ilk addımlar.',
    cars: [{ make: 'Mitsubishi', model: 'Pajero Sport', year: 2019, trim: 'mitsubishi-pajerosport3-24d', color: 'Boz', photo: true, mods: [m('Yokohama Geolandar A/T G015', 'tyres', 2300)] }],
  },
  {
    slug: 'xeyal.allahverdiyev', name: 'Xəyal Allahverdiyev', display: 'Xəyal A.', city: 'Quba', since: 35, clan: 'DMK', role: 'member', joined: 20, avatar: true,
    bio: 'Qubalıyam, Xınalıq yolunu gözüyumulu sürürəm.',
    cars: [
      {
        make: 'Toyota', model: 'Land Cruiser', year: 2010, trim: 'toyota-lc200-45d-286', color: 'Qara', photo: true,
        mods: [m('2" spacer lift', 'lift', 900), m('Çin bucurqadı 12000 lb', 'recovery', 850), m('LED fənər dəsti', 'lighting', 300)],
      },
    ],
  },
  // ---------------- Abşeron 4x4 (A4X) ----------------
  {
    slug: 'tural.quliyev', name: 'Tural Quliyev', display: 'Tural Q.', city: 'Bakı', since: 165, clan: 'A4X', role: 'leader', joined: 130, avatar: true,
    bio: 'Abşeron 4x4 klubunun qurucusu. Qum, palçıq, daş — fərqi yoxdur.',
    cars: [
      {
        make: 'Toyota', model: 'Hilux', year: 2019, trim: 'toyota-hilux8-28d-177', color: 'Boz', body: 'pickup', photo: true,
        mods: [
          m('Dobinsons 2" lift', 'lift', 3100, true),
          m('BFGoodrich KM3 (palçıq üçün)', 'tyres', 4200),
          m('Runva 11XP bucurqad', 'recovery', 2200, true),
          m('Polad ön bamper', 'bumpers', 2500),
          m('Rock slider', 'armour', 1100),
        ],
      },
      {
        make: 'Toyota', model: 'Land Cruiser Prado', year: 2018, trim: 'toyota-prado150-28d-177', color: 'Ağ', photo: true,
        mods: [m('Dam bagajı', 'roof', 1300), m('Kompressor ARB', 'recovery', 950, true)],
      },
    ],
  },
  {
    slug: 'aysel.huseynova', name: 'Aysel Hüseynova', display: 'Aysel Hüseynova', city: 'Bakı', since: 130, clan: 'A4X', role: 'officer', joined: 125, avatar: true,
    bio: 'Bələdçi və klubun ən qorxmaz sürücüsü. Wrangler-im qırmızıdır, ürəyim də.',
    cars: [
      {
        make: 'Jeep', model: 'Wrangler', year: 2020, trim: 'jeep-wrangler-jl-36', color: 'Qırmızı', photo: true,
        mods: [
          m('Teraflex 2.5" lift', 'lift', 4500),
          m('Falken Wildpeak M/T 35"', 'tyres', 5200, true),
          m('Warn VR EVO 10-S', 'recovery', 1800, false, 'USD'),
          m('LED işıq paneli 50"', 'lighting', 650),
        ],
      },
    ],
  },
  {
    slug: 'farid.nabiyev', name: 'Fərid Nəbiyev', display: 'Fərid N.', city: 'Bakı', since: 115, clan: 'A4X', role: 'member', joined: 95,
    bio: 'G-Class asfalt üçün deyil, bunu sübut edirəm.',
    cars: [{ make: 'Mercedes-Benz', model: 'G-Class', year: 2019, trim: 'mb-g-w463-g500', color: 'Qara', photo: true, mods: [m('BFGoodrich KO2 275/65R20', 'tyres', 4400, true)] }],
  },
  {
    slug: 'emin.qasimov', name: 'Emin Qasımov', display: 'Emin Qasımov', city: 'Bakı', since: 105, clan: 'A4X', role: 'member', joined: 80,
    bio: 'Grand Cherokee + kamera = hər səfərdən video.',
    cars: [{ make: 'Jeep', model: 'Grand Cherokee', year: 2017, trim: 'jeep-gc-wk2-30d', color: 'Tünd boz', photo: true }],
  },
  {
    slug: 'gunay.malikova', name: 'Günay Məlikova', display: 'Günay M.', city: 'Bakı', since: 90, clan: 'A4X', role: 'member', joined: 65, avatar: true,
    bio: 'LX ilə həm şəhər, həm dağ. Düşərgədə çay mənlikdir ☕',
    cars: [{ make: 'Lexus', model: 'LX', year: 2016, trim: 'lexus-lx570', color: 'Ağ', photo: true }],
  },
  {
    slug: 'samir.novruzov', name: 'Samir Novruzov', display: 'Samir N.', city: 'Sumqayıt', since: 30, clan: 'A4X', role: 'member', joined: 8,
    bio: 'Sarı FJ-im var, yolda görsəniz salam verin.',
    cars: [
      {
        make: 'Toyota', model: 'FJ Cruiser', year: 2012, trim: 'toyota-fjcruiser-40', color: 'Sarı', photo: true,
        mods: [m('Bilstein 5100 amortizatorlar', 'suspension', 1700), m('Cooper Discoverer AT3', 'tyres', 2500)],
      },
    ],
  },
  {
    slug: 'fuad.valiyev', name: 'Fuad Vəliyev', display: 'Fuad V.', city: 'Bakı', since: 85, clan: 'A4X', role: 'member', joined: 50,
    bio: 'İki Jeep, bir Jimny və heç bitməyən layihələr.',
    cars: [
      {
        make: 'Jeep', model: 'Wrangler', year: 2021, trim: 'jeep-wrangler-jl-20t', color: 'Narıncı', photo: true,
        mods: [m('Rubicon ön bamper', 'bumpers', 1900), m('Rock slider', 'armour', 980), m('Smittybilt bucurqad', 'recovery', 1250, true)],
      },
      { make: 'Suzuki', model: 'Jimny', year: 2019, trim: 'suzuki-jimny-jb74', color: 'Yaşıl', body: 'small', photo: true, mods: [m('2" lift dəsti', 'lift', 1500)] },
    ],
  },
  // ---------------- Qafqaz Yolçuları (QFY) ----------------
  {
    slug: 'orxan.hasanov', name: 'Orxan Həsənov', display: 'Orxan Həsənov', city: 'Quba', since: 170, clan: 'QFY', role: 'leader', joined: 145, avatar: true,
    bio: 'Qafqaz Yolçularının başçısı. Quba–Qusar dağlarında doğulmuşam.',
    cars: [
      {
        make: 'Mitsubishi', model: 'Pajero', year: 2016, trim: 'mitsubishi-pajero4-32d-190', color: 'Ağ', photo: true,
        mods: [
          m('Ironman 2" lift', 'lift', 2800),
          m('Mickey Thompson Baja Boss A/T', 'tyres', 3500, true),
          m('Snorkel', 'engine', 480),
          m('Arxa polad bamper', 'bumpers', 1700, true),
        ],
      },
      { make: 'UAZ', model: 'Hunter', year: 2012, engine: '2.7 benzin', engineL: 2.7, hp: 128, transmission: 'manual', fuel: 'petrol', color: 'Haki yaşıl', photo: true, description: 'Köhnə, amma heç vaxt yolda qoymayıb.', mods: [m('Rus bucurqadı', 'recovery', 600)] },
    ],
  },
  {
    slug: 'kamran.ismayilov', name: 'Kamran İsmayılov', display: 'Kamran İ.', city: 'Qəbələ', since: 150, clan: 'QFY', role: 'officer', joined: 140,
    bio: 'Bələdçi. Qəbələ–Laza aşırımını ildə 20 dəfə keçirəm.',
    cars: [
      {
        make: 'Toyota', model: '4Runner', year: 2018, trim: 'toyota-4runner5-40', color: 'Qəhvəyi', photo: true,
        mods: [m('Icon 3" lift', 'lift', 4600, true), m('Toyo Open Country R/T', 'tyres', 3200), m('Prinsu dam bagajı', 'roof', 1400)],
      },
    ],
  },
  {
    slug: 'nigar.karimova', name: 'Nigar Kərimova', display: 'Nigar K.', city: 'Gəncə', since: 100, clan: 'QFY', role: 'member', joined: 75, avatar: true,
    bio: 'Jimny kiçikdir, amma iradəsi böyükdür. Göygöl tərəflərdəyəm.',
    cars: [
      {
        make: 'Suzuki', model: 'Jimny', year: 2021, trim: 'suzuki-jimny-jb74', color: 'Yaşıl', body: 'small', photo: true,
        mods: [m('Bilstein lift dəsti 2"', 'lift', 1900), m('BFGoodrich KO2 215/75R15', 'tyres', 1700), m('Dam bagajı', 'roof', 700)],
      },
    ],
  },
  {
    slug: 'anar.mustafayev', name: 'Anar Mustafayev', display: 'Anar M.', city: 'Gəncə', since: 110, clan: 'QFY', role: 'member', joined: 85,
    bio: 'L200 ilə Gədəbəy dağlarını gəzirəm.',
    cars: [{ make: 'Mitsubishi', model: 'L200', year: 2018, trim: 'mitsubishi-l200-5-24d-154', color: 'Boz', body: 'pickup', photo: true }],
  },
  {
    slug: 'zaur.haciyev', name: 'Zaur Hacıyev', display: 'Zaur Hacıyev', city: 'Lənkəran', since: 120, clan: 'QFY', role: 'member', joined: 90,
    bio: 'Talış dağları, çay bağları və palçıq. Lənkərandan salamlar.',
    cars: [
      { make: 'UAZ', model: 'Patriot', year: 2019, trim: 'uaz-patriot-27-150', color: 'Yaşıl', photo: true, mods: [m('Diferensial kilidi', 'other', 1600), m('MT təkərlər 31"', 'tyres', 2100)] },
      { make: 'Lada', model: 'Niva', year: 2015, engine: '1.7 benzin', engineL: 1.7, hp: 83, transmission: 'manual', fuel: 'petrol', color: 'Ağ', body: 'small', photo: false },
    ],
  },
  {
    slug: 'rauf.asgarov', name: 'Rauf Əsgərov', display: 'Rauf Ə.', city: 'Zaqatala', since: 130, clan: 'QFY', role: 'member', joined: 100,
    bio: 'Zaqatala meşələrinin sakini. Fındıq mövsümündə də yoldayam.',
    cars: [
      { make: 'Toyota', model: 'Hilux', year: 2016, trim: 'toyota-hilux8-24d', color: 'Ağ', body: 'pickup', photo: true },
      { make: 'Mitsubishi', model: 'Pajero', year: 2010, trim: 'mitsubishi-pajero4-30', color: 'Gümüşü', photo: true },
    ],
  },
  {
    slug: 'togrul.abdullayev', name: 'Toğrul Abdullayev', display: 'Toğrul A.', city: 'Şəki', since: 22, clan: 'QFY', role: 'member', joined: 15,
    bio: 'Şəkidən yeni sürücü. Mohave ilə İlisu yoluna hazırlaşıram.',
    cars: [{ make: 'Kia', model: 'Mohave', year: 2019, engine: '3.0 V6 dizel', engineL: 3, hp: 260, transmission: 'automatic', fuel: 'diesel', color: 'Qara', photo: true }],
  },
  // ---------------- Niva Klubu (NIVA) ----------------
  {
    slug: 'ramil.abbasov', name: 'Ramil Abbasov', display: 'Ramil Abbasov', city: 'Mingəçevir', since: 155, clan: 'NIVA', role: 'leader', joined: 120, avatar: true,
    bio: 'Niva Klubunun başçısı. Niva ucuzdur, amma hər yerə çıxır — bunu hamıya göstəririk.',
    cars: [
      {
        make: 'Lada', model: 'Niva Travel', year: 2021, trim: 'lada-niva-travel-17', color: 'Qəhvəyi', body: 'small', photo: true,
        mods: [m('Lift 50 mm', 'lift', 650), m('Kama Flame MT', 'tyres', 900), m('Ön polad bamper', 'bumpers', 750)],
      },
      { make: 'Lada', model: 'Niva', year: 2009, engine: '1.7 benzin', engineL: 1.7, hp: 80, transmission: 'manual', fuel: 'petrol', color: 'Ağ', body: 'small', photo: true, description: 'İlk sevgim. 300 min km.' },
    ],
  },
  {
    slug: 'elcin.cafarov', name: 'Elçin Cəfərov', display: 'Elçin C.', city: 'Xaçmaz', since: 125, clan: 'NIVA', role: 'officer', joined: 110,
    bio: 'Bələdçi. Nabran meşələri və dəniz kənarı yollar.',
    cars: [
      { make: 'Lada', model: 'Niva Legend', year: 2023, trim: 'lada-niva-legend-17', color: 'Yaşıl', body: 'small', photo: true, mods: [m('Dam bagajı', 'roof', 420), m('LED panel', 'lighting', 190)] },
      { make: 'UAZ', model: 'Patriot', year: 2017, trim: 'uaz-patriot-27-135', color: 'Boz', photo: true },
    ],
  },
  {
    slug: 'sabina.ahmadova', name: 'Səbinə Əhmədova', display: 'Səbinə Ə.', city: 'Şəki', since: 80, clan: 'NIVA', role: 'member', joined: 55, avatar: true,
    bio: 'Şəkinin dağ kəndlərinə Niva ilə gedirəm. Kiş meşəsi favoritimdir.',
    cars: [{ make: 'Lada', model: 'Niva Legend', year: 2022, trim: 'lada-niva-legend-17', color: 'Qırmızı', body: 'small', photo: true, mods: [m('AT təkərlər', 'tyres', 800, true)] }],
  },
  {
    slug: 'kenan.rustamov', name: 'Kənan Rüstəmov', display: 'Kənan R.', city: 'Qəbələ', since: 18, clan: 'NIVA', role: 'member', joined: 6,
    bio: 'Yeni Niva, yeni dostlar.',
    cars: [{ make: 'Lada', model: 'Niva Travel', year: 2022, trim: 'lada-niva-travel-17', color: 'Ağ', body: 'small', photo: true }],
  },
  {
    slug: 'mahir.ahmadli', name: 'Mahir Əhmədli', display: 'Mahir Ə.', city: 'Mingəçevir', since: 70, clan: 'NIVA', role: 'member', joined: 45,
    bio: 'Mingəçevir su anbarı sahilləri və UAZ həvəskarı.',
    cars: [
      { make: 'UAZ', model: 'Hunter', year: 2014, engine: '2.7 benzin', engineL: 2.7, hp: 128, transmission: 'manual', fuel: 'petrol', color: 'Haki yaşıl', photo: true },
      { make: 'Lada', model: 'Niva Legend', year: 2021, trim: 'lada-niva-legend-17', color: 'Bej', body: 'small', photo: false },
    ],
  },
  // ---------------- no clan ----------------
  {
    slug: 'nurlan.babayev', name: 'Nurlan Babayev', display: 'Nurlan B.', city: 'Naxçıvan', since: 140,
    bio: 'Naxçıvan dağlarından. Batabat yaylasına gələn olsa, yol göstərərəm.',
    cars: [{ make: 'Mitsubishi', model: 'Pajero', year: 2008, trim: 'mitsubishi-pajero4-38', color: 'Tünd boz', photo: true, mods: [m('Lift 2"', 'lift', 1800), m('Yokohama MT', 'tyres', 2600)] }],
  },
  {
    slug: 'aynur.sadiqova', name: 'Aynur Sadıqova', display: 'Aynur S.', city: 'Bakı', since: 40,
    bio: 'Santa Fe ilə yüngül yollar. Çətin marşrutları öyrənmək istəyirəm.',
    cars: [{ make: 'Hyundai', model: 'Santa Fe', year: 2020, engine: '2.2 dizel', engineL: 2.2, hp: 200, transmission: 'automatic', fuel: 'diesel', color: 'Mavi', photo: true }],
  },
  {
    slug: 'parviz.humbatov', name: 'Pərviz Hümbətov', display: 'Pərviz H.', city: 'Gəncə', since: 60,
    bio: 'Sorento ilə Göygöl və Hacıkənd tərəfləri.',
    cars: [{ make: 'Kia', model: 'Sorento', year: 2017, engine: '2.2 dizel', engineL: 2.2, hp: 200, transmission: 'automatic', fuel: 'diesel', color: 'Gümüşü', photo: true, mods: [m('AT təkərlər', 'tyres', 1900)] }],
  },
  {
    slug: 'lale.nagiyeva', name: 'Lalə Nağıyeva', display: 'Lalə N.', city: 'Şamaxı', since: 50, avatar: true,
    bio: 'Ağ Jimny, kamera və termos. Şamaxı–Lahıc yolunun aşiqiyəm.',
    cars: [{ make: 'Suzuki', model: 'Jimny', year: 2022, trim: 'suzuki-jimny-jb74', color: 'Ağ', body: 'small', photo: true, mods: [m('Dam bagajı', 'roof', 650), m('Snorkel', 'engine', 380, true)] }],
  },
  {
    slug: 'shahin.yusifov', name: 'Şahin Yusifov', display: 'Şahin Y.', city: 'Sumqayıt', since: 75,
    bio: 'Prado 120 dizel, 400 min km və hələ də güclüdür.',
    cars: [{ make: 'Toyota', model: 'Land Cruiser Prado', year: 2007, trim: 'toyota-prado120-30d-173', color: 'Qəhvəyi', photo: true, mods: [m('OME lift', 'lift', 2200), m('Bucurqad', 'recovery', null)] }],
  },
];

export type DemoClan = { tag: ClanTag; name: string; city: string; isOpen: boolean; since: number; description: string; hue: string; requests: string[] };
export const CLANS: DemoClan[] = [
  {
    tag: 'DMK', name: 'Dəmir Karvan', city: 'Bakı', isOpen: false, since: 140, hue: '#8A5A2B',
    description: 'Həftəsonu dağ ekspedisiyaları: Xızı, Şahdağ, Quba. Təhlükəsizlik birinci, ratsiya mütləqdir. Qoşulmaq üçün sorğu göndərin.',
    requests: ['shahin.yusifov'],
  },
  {
    tag: 'A4X', name: 'Abşeron 4x4', city: 'Bakı', isOpen: false, since: 130, hue: '#C2410C',
    description: 'Bakı və Abşeron sürücüləri. Qum, palçıq və gecə turları. Yeni başlayanlara kömək edirik.',
    requests: ['aynur.sadiqova'],
  },
  {
    tag: 'QFY', name: 'Qafqaz Yolçuları', city: 'Quba', isOpen: false, since: 145, hue: '#3E5B3A',
    description: 'Quba, Qusar, Qəbələ və Şəki dağ yolları. Çoxgünlük düşərgələr və yaylalar.',
    requests: ['parviz.humbatov', 'lale.nagiyeva'],
  },
  {
    tag: 'NIVA', name: 'Niva Klubu', city: 'Mingəçevir', isOpen: true, since: 120, hue: '#6A4A32',
    description: 'Niva və UAZ sahibləri üçün açıq klub. Bahalı maşın lazım deyil — həvəs lazımdır!',
    requests: [],
  },
];

export type DemoSpot = {
  owner: string;
  type: 'trail' | 'camp';
  name: string;
  lat: number;
  lng: number;
  d?: number;
  season: string;
  tags: string[];
  daysAgo: number;
  description: string;
};
export const SPOTS: DemoSpot[] = [
  // ---- trails ----
  { owner: 'reshad.mammadov', type: 'trail', name: 'Xızı — Qırmızı-ağ dağlar', lat: 40.952, lng: 49.112, d: 3, season: 'Aprel–Oktyabr, quru günlər', tags: ['gil', 'mənzərə', 'foto'], daysAgo: 88,
    description: 'Məşhur zolaqlı dağlar. Gil yamaclar yağışdan sonra çox sürüşkən olur. Aşağı ötürücü və AT təkərlər tövsiyə olunur.' },
  { owner: 'aysel.huseynova', type: 'trail', name: 'Qobustan palçıq vulkanları', lat: 40.083, lng: 49.402, d: 1, season: 'Bütün il, yağışdan sonra yox', tags: ['palçıq vulkanı', 'çınqıl', 'ailəvi'], daysAgo: 80,
    description: 'Qobustandan vulkanlara çınqıl və torpaq yol. Quru havada istənilən SUV keçir. Yağışdan sonra yol palçığa dönür.' },
  { owner: 'elnur.aliyev', type: 'trail', name: 'Şahdağ yaylası yolu', lat: 41.318, lng: 48.142, d: 4, season: 'İyun–Sentyabr', tags: ['daş', 'yüksəklik', 'çay keçidi'], daysAgo: 75,
    description: 'Qusar tərəfdən dik döngələrlə daşlı dağ yolu. Bir neçə çay keçidi var. Kilid və lift olmadan getməyin.' },
  { owner: 'lale.nagiyeva', type: 'trail', name: 'Lahıc–İsmayıllı meşə yolu', lat: 40.851, lng: 48.392, d: 2, season: 'May–Oktyabr', tags: ['meşə', 'çay', 'kənd'], daysAgo: 45,
    description: 'Girdimançay boyunca dar meşə yolu. Qarşıdan gələn maşınlara diqqət edin, bəzi yerlərdə ancaq bir maşın keçir.' },
  { owner: 'orxan.hasanov', type: 'trail', name: 'Quba–Xınalıq dağ yolu', lat: 41.215, lng: 48.258, d: 2, season: 'May–Noyabr', tags: ['dağ', 'kənd', 'mənzərə'], daysAgo: 70,
    description: 'Qudyalçay dərəsi ilə Xınalığa gedən yol. Əsas yol asfaltdır, amma yan yollar çınqıl və daşlıdır. Dumanda ehtiyatlı olun.' },
  { owner: 'kamran.ismayilov', type: 'trail', name: 'Qəbələ–Laza aşırımı', lat: 41.072, lng: 47.962, d: 3, season: 'İyul–Sentyabr', tags: ['aşırım', 'yayla', 'daş'], daysAgo: 66,
    description: 'Qəbələdən yaylaya qalxan köhnə çoban yolu. Yuxarı hissədə daşlıq və dik qalxış var. Yayda belə hava tez dəyişir.' },
  { owner: 'xeyal.allahverdiyev', type: 'trail', name: 'Qusar ətəkləri', lat: 41.372, lng: 48.402, d: 2, season: 'Aprel–Noyabr', tags: ['meşə', 'çəmən'], daysAgo: 14,
    description: 'Qusar ətrafında meşə və çəmən yolları. Yazda bəzi yerlər palçıqlı olur. Yeni başlayanlar üçün yaxşı məşq yeridir.' },
  { owner: 'tural.quliyev', type: 'trail', name: 'Altıağac meşə yolu', lat: 40.862, lng: 48.935, d: 2, season: 'Aprel–Oktyabr', tags: ['meşə', 'milli park yaxınlığı'], daysAgo: 60,
    description: 'Altıağac kəndindən meşəyə gedən torpaq yol. Milli parkın qaydalarına əməl edin, zibil qoymayın.' },
  { owner: 'anar.mustafayev', type: 'trail', name: 'Gədəbəy təpələri', lat: 40.571, lng: 45.812, d: 3, season: 'May–Oktyabr', tags: ['təpə', 'yayla', 'mənzərə'], daysAgo: 55,
    description: 'Gədəbəy ətrafında yaşıl təpələr və yayla yolları. Bəzi qalxışlar dikdir, yaş otun üstündə təkərlər sürüşür.' },
  { owner: 'togrul.abdullayev', type: 'trail', name: 'Şəki–İlisu dağ yolu', lat: 41.335, lng: 47.102, d: 4, season: 'İyun–Oktyabr', tags: ['dağ', 'çay keçidi', 'daş'], daysAgo: 9,
    description: 'Şəkidən İlisuya dağ ilə keçən yol. Kurmukçay keçidi yazda dərin olur. Ən azı iki maşınla gedin.' },
  { owner: 'rauf.asgarov', type: 'trail', name: 'Zaqatala meşə yolu', lat: 41.682, lng: 46.671, d: 3, season: 'May–Oktyabr', tags: ['meşə', 'palçıq', 'şəlalə'], daysAgo: 50,
    description: 'Qoruğa yaxın sıx meşə yolu. Yağışdan sonra dərin palçıq olur, bucurqadı olan maşın qrupda olsun.' },
  { owner: 'ramil.abbasov', type: 'trail', name: 'Naftalan çölləri', lat: 40.512, lng: 46.822, d: 1, season: 'Bütün il', tags: ['çöl', 'çınqıl', 'ailəvi'], daysAgo: 40,
    description: 'Naftalan ətrafında geniş çöl yolları. Qışda da sürmək olar. Yayda su götürməyi unutmayın.' },
  { owner: 'tural.quliyev', type: 'trail', name: 'Abşeron qum təpələri', lat: 40.552, lng: 49.812, d: 2, season: 'Oktyabr–May', tags: ['qum', 'dəniz', 'gecə'], daysAgo: 17,
    description: 'Dəniz sahili boyunca qum təpələri. Təkər təzyiqini 1.2–1.4 bar-a endirin. Yayda çimərlik zonalarına girməyin.' },
  { owner: 'cavid.bagirov', type: 'trail', name: 'Beşbarmaq dağı ətəyi', lat: 40.981, lng: 49.185, d: 3, season: 'Mart–Noyabr', tags: ['daş', 'mənzərə'], daysAgo: 30,
    description: 'Beşbarmaq dağının arxa tərəfindən daşlı yol. Ziyarətgaha hörmətlə yanaşın, maşınla yaxın getməyin.' },
  { owner: 'kamran.ismayilov', type: 'trail', name: 'Tufandağ ətəyi', lat: 41.052, lng: 47.832, d: 4, season: 'İyul–Sentyabr', tags: ['dağ', 'daş', 'yüksəklik'], daysAgo: 6,
    description: 'Qəbələnin şimalında yüksək dağ yolu. Daşlı, dar və dik. Lift və kilid tövsiyə olunur.' },
  { owner: 'vuqar.safarov', type: 'trail', name: 'Pirqulu meşəsi', lat: 40.781, lng: 48.582, d: 2, season: 'Aprel–Noyabr', tags: ['meşə', 'rəsədxana'], daysAgo: 35,
    description: 'Şamaxı rəsədxanası yaxınlığında meşə yolları. Payızda rənglər möhtəşəmdir.' },
  { owner: 'aysel.huseynova', type: 'trail', name: 'Lökbatan palçıq vulkanı', lat: 40.332, lng: 49.722, d: 1, season: 'Bütün il', tags: ['palçıq vulkanı', 'şəhərə yaxın'], daysAgo: 4,
    description: 'Bakıya ən yaxın palçıq vulkanı. Qısa, asan yol — yeni başlayanlar üçün ideal.' },
  { owner: 'zaur.haciyev', type: 'trail', name: 'Lerik dağ yolu', lat: 38.772, lng: 48.418, d: 3, season: 'May–Oktyabr', tags: ['dağ', 'meşə', 'duman'], daysAgo: 58,
    description: 'Talış dağlarında Lerikə qalxan yan yollar. Duman çox olur, işıqlarınızı yandırın.' },
  { owner: 'zaur.haciyev', type: 'trail', name: 'Yardımlı meşə yolu', lat: 38.902, lng: 48.252, d: 3, season: 'May–Oktyabr', tags: ['meşə', 'palçıq'], daysAgo: 19,
    description: 'Yardımlı ətrafında sıx meşə. Payızda yarpaqların altında palçıq gizlənir.' },
  { owner: 'nigar.karimova', type: 'trail', name: 'Daşkəsən dağ yolu', lat: 40.522, lng: 46.081, d: 4, season: 'İyun–Sentyabr', tags: ['dağ', 'daş', 'yayla'], daysAgo: 48,
    description: 'Köhnə mədən yolları ilə yaylaya qalxış. Bəzi yerlərdə yol çökür, kəşfiyyatla gedin.' },
  { owner: 'parviz.humbatov', type: 'trail', name: 'Hacıkənd yolu', lat: 40.552, lng: 46.301, d: 2, season: 'Aprel–Noyabr', tags: ['meşə', 'çay'], daysAgo: 12,
    description: 'Göygöl rayonunda Hacıkəndə gedən meşə yolu. Asan, amma yağışdan sonra sürüşkəndir.' },
  { owner: 'orxan.hasanov', type: 'trail', name: 'Xınalıq–Laza keçidi', lat: 41.212, lng: 48.052, d: 5, season: 'Avqust–Sentyabr', tags: ['ekstrem', 'daş', 'aşırım'], daysAgo: 85,
    description: 'Ancaq təcrübəli sürücülər üçün. Uçurum kənarında dar yol, iri daşlar. Bucurqad, kilid və ratsiya mütləqdir.' },
  { owner: 'elnur.aliyev', type: 'trail', name: 'Qudyalçay kanyonu', lat: 41.322, lng: 48.402, d: 5, season: 'Avqust–Oktyabr', tags: ['kanyon', 'su', 'bucurqad'], daysAgo: 3,
    description: 'Çay yatağı ilə kanyon keçidi. Su səviyyəsi tez dəyişir. Yazda getməyin. Ən azı 3 maşın.' },
  { owner: 'elcin.cafarov', type: 'trail', name: 'Nabran meşə yolları', lat: 41.792, lng: 48.622, d: 1, season: 'Aprel–Oktyabr', tags: ['meşə', 'dəniz', 'ailəvi'], daysAgo: 25,
    description: 'Nabran meşələrində sakit torpaq yollar. Dənizə yaxın, ailəvi gəzinti üçün əladır.' },
  { owner: 'nurlan.babayev', type: 'trail', name: 'Batabat yaylası yolu', lat: 39.552, lng: 45.782, d: 3, season: 'İyun–Sentyabr', tags: ['yayla', 'göl', 'yüksəklik'], daysAgo: 65,
    description: 'Şahbuzdan Batabat yaylasına qalxış. Yolun sonunda üzən adalı göl. Gecələr çox soyuq olur.' },
  // ---- camps ----
  { owner: 'xeyal.allahverdiyev', type: 'camp', name: 'Laza şəlalələri düşərgəsi', lat: 41.302, lng: 48.118, season: 'İyun–Sentyabr', tags: ['şəlalə', 'çəmən', 'ocaq yeri'], daysAgo: 28,
    description: 'Şəlalələrə yaxın düz çəmən. 8–10 maşına yer var. Gecə temperaturu 5°C-yə enə bilər.' },
  { owner: 'gunay.malikova', type: 'camp', name: 'Altıağac meşə düşərgəsi', lat: 40.855, lng: 48.922, season: 'Aprel–Oktyabr', tags: ['meşə', 'kölgə'], daysAgo: 52,
    description: 'Meşə kənarında kölgəli sahə. Odunu özünüzlə gətirin, ağac kəsməyin.' },
  { owner: 'kamran.ismayilov', type: 'camp', name: 'Nohur gölü yaxınlığı', lat: 41.012, lng: 47.808, season: 'May–Oktyabr', tags: ['göl', 'ailəvi'], daysAgo: 20,
    description: 'Gölün yuxarısında sakit sahə. Yaxınlıqda kənd var, çörək almaq olur.' },
  { owner: 'nigar.karimova', type: 'camp', name: 'Toğanalı meşə düşərgəsi', lat: 40.482, lng: 46.332, season: 'May–Sentyabr', tags: ['meşə', 'çay'], daysAgo: 38,
    description: 'Göygöl rayonunda çay kənarında düşərgə yeri. Yayda belə gecələr sərindir.' },
  { owner: 'sabina.ahmadova', type: 'camp', name: 'İlisu çay sahili', lat: 41.468, lng: 47.052, season: 'May–Oktyabr', tags: ['çay', 'ocaq yeri'], daysAgo: 16,
    description: 'Kurmukçay sahilində düz yer. Yaz sellərində çaya çox yaxın qurmayın.' },
  { owner: 'zaur.haciyev', type: 'camp', name: 'Talış meşəsi düşərgəsi', lat: 38.732, lng: 48.552, season: 'Aprel–Oktyabr', tags: ['meşə', 'duman', 'çay bağları'], daysAgo: 42,
    description: 'Lerik yolunda meşə içində kiçik açıqlıq. 4–5 maşına yer var.' },
  { owner: 'orxan.hasanov', type: 'camp', name: 'Xınalıq yaylası düşərgəsi', lat: 41.172, lng: 48.132, season: 'İyul–Sentyabr', tags: ['yayla', 'ulduzlar', 'soyuq'], daysAgo: 62,
    description: 'Yaylada geniş düz sahə. Küləkli olur, çadırı yaxşı bərkidin. Ulduzlu səma möhtəşəmdir.' },
  { owner: 'sabina.ahmadova', type: 'camp', name: 'Marxal yaylası', lat: 41.222, lng: 47.232, season: 'May–Oktyabr', tags: ['yayla', 'meşə'], daysAgo: 2,
    description: 'Şəkinin yuxarısında meşə ilə əhatə olunmuş yayla. Bulaq suyu var.' },
];

/** [sender slug, text, days ago, Baku hour (decimal)] */
export type Line = [string, string, number, number];

export const CLAN_CHATS: Record<ClanTag, Line[]> = {
  DMK: [
    ['reshad.mammadov', 'Salam karvan! Bu şənbə Xızıya çıxırıq, kim gəlir?', 18, 20.5],
    ['elnur.aliyev', 'Mən varam. Marşrutu artıq çəkmişəm, tədbirə əlavə edəcəm.', 18, 20.7],
    ['leyla.rzayeva', 'Mən də gəlirəm, səhər işığında yaxşı kadrlar olur 📸', 18, 21.1],
    ['vuqar.safarov', 'Şamaxıdan birbaşa gələcəm, Sumqayıt dairəsində görüşək?', 17, 9.2],
    ['cavid.bagirov', 'Ratsiyaları kanal 7-də saxlayaq', 17, 12.4],
    ['murad.kazimov', 'Gil yolda LC300 necə olacaq görəsən 😅', 16, 19.0],
    ['reshad.mammadov', 'Narahat olma, təzyiqi endirərik, arxamca sür.', 16, 19.3],
    ['ilkin.zeynalov', 'Möhtəşəm gün idi, hamıya təşəkkürlər! Şəkilləri qrupa atıram.', 14, 22.0],
    ['elnur.aliyev', 'Növbəti dəfə Şahdağ yolu. Lift olmayanlara tövsiyə etmirəm.', 8, 21.5],
    ['xeyal.allahverdiyev', 'Qubadan qoşularam, yolu tanıyıram.', 8, 22.1],
    ['ulvi.rahimov', 'Salam hamıya, klana yeni qoşulmuşam. Pajero Sport-la Şahdağa çıxmaq olar?', 7, 18.4],
    ['reshad.mammadov', 'Xoş gəldin Ülvi! İlk dəfə Qusar ətəklərində məşq et, sonra Şahdağ.', 7, 18.9],
    ['cavid.bagirov', 'Şahdağ əla keçdi. Murad, karterə şükür et 😄', 2, 21.0],
    ['murad.kazimov', 'Bəli, qoruyucu olmasaydı bitmişdi. 1450 manat dəydi!', 2, 21.3],
    ['elnur.aliyev', 'Bu ay klan gəzintisi Beşbarmaq tərəfə — ancaq bizimkilər üçün. Tədbiri açdım.', 1, 13.2],
    ['leyla.rzayeva', 'Qeyd olundum 👍', 1, 14.0],
  ],
  A4X: [
    ['tural.quliyev', 'Dostlar, Qobustan ailəvi turu üçün qeydiyyat açıqdır.', 30, 19.0],
    ['aysel.huseynova', 'Yeni başlayanları da çağırın, yol asandır.', 30, 19.4],
    ['gunay.malikova', 'Mən çay və şirniyyat gətirirəm ☕', 29, 10.2],
    ['emin.qasimov', 'Dron da götürürəm, video çəkərik', 28, 20.1],
    ['farid.nabiyev', 'Mənim G yenə servisdədir, gələ bilməyəcəm 😔', 27, 13.5],
    ['tural.quliyev', 'Hamıya sağ olun, əla gün idi! Uşaqlar vulkanlardan çox razı qaldı.', 25, 21.0],
    ['samir.novruzov', 'Salam, Sumqayıtdan Samir. FJ ilə qoşuldum!', 7, 17.0],
    ['aysel.huseynova', 'Xoş gəldin Samir! Növbəti gecə turunda görüşərik.', 7, 17.4],
    ['fuad.valiyev', 'Altıağac gecəsinə yer qalmadı, mən gözləmə siyahısındayam', 4, 12.0],
    ['tural.quliyev', 'Kim imtina etsə, Fuad avtomatik keçəcək. Narahat olma.', 4, 12.3],
    ['emin.qasimov', 'Qum təpələrində təzyiq neçə olmalıdır?', 2, 20.8],
    ['aysel.huseynova', '1.2–1.4 bar. Kompressoru unutmayın, geri asfaltda vurmaq lazımdır.', 2, 21.0],
  ],
  QFY: [
    ['orxan.hasanov', 'Laza düşərgəsi üçün çadır siyahısını yazın zəhmət olmasa.', 38, 20.0],
    ['kamran.ismayilov', 'Mənim 2 nəfərlik çadır və qazan var.', 38, 20.3],
    ['nigar.karimova', 'Gəncədən Anarla birlikdə gələcəyik.', 37, 11.0],
    ['anar.mustafayev', 'L200-ün kuzovuna odun yükləyirəm 🔥', 36, 18.2],
    ['zaur.haciyev', 'Lənkərandan yol uzundur, cümə axşamı çıxacam.', 36, 21.4],
    ['rauf.asgarov', 'Zaqataladan fındıq gətirirəm hamıya 😄', 35, 9.5],
    ['orxan.hasanov', 'Gecə 3°C idi, amma ocaq hər şeyi həll etdi. Sağ olun dostlar!', 31, 19.0],
    ['kamran.ismayilov', 'Qəbələ–Laza aşırımında qar başlayıb, bu həftə qalxmayın.', 10, 8.3],
    ['togrul.abdullayev', 'Salam, Şəkidən Toğrul. Klana qəbul etdiyiniz üçün sağ olun!', 9, 16.0],
    ['orxan.hasanov', 'Xoş gəldin! İlisu yolunu birlikdə gedərik.', 9, 16.5],
    ['nigar.karimova', 'Talış səfərinə kim gedir? Zaur tədbir açıb.', 3, 13.0],
    ['zaur.haciyev', 'Hələ yer var, gəlin! Lerikdə çay bağlarını göstərəcəm.', 3, 13.6],
    ['rauf.asgarov', 'Mən gəlirəm, Hilux hazırdır.', 3, 15.2],
  ],
  NIVA: [
    ['ramil.abbasov', 'Niva qardaşları, bu ay gecə turu Abşeron qumlarında!', 12, 19.0],
    ['elcin.cafarov', 'Xaçmazdan gələcəm, səhər tezdən çıxaram.', 12, 19.6],
    ['sabina.ahmadova', 'Şəkidən uzaqdır, amma buna dəyər 😊', 11, 10.4],
    ['mahir.ahmadli', 'UAZ-ı da gətirim? Qumda necə olar?', 11, 12.0],
    ['ramil.abbasov', 'Gətir, qumda batan olsa, UAZ dartar 😄', 11, 12.2],
    ['kenan.rustamov', 'Salam, yeni Niva Travel almışam. Klana xoş gəldim!', 6, 18.0],
    ['elcin.cafarov', 'Xoş gəldin Kənan! Yağ dəyişməyi unutma, 1000 km-də.', 6, 18.3],
    ['sabina.ahmadova', 'Gecə turu super idi! Qumda heç kim batmadı.', 4, 23.5],
    ['ramil.abbasov', 'Növbəti dəfə Naftalan yolları. Tədbiri açıram.', 2, 20.0],
    ['mahir.ahmadli', 'Qeyd oldum 👍', 2, 20.4],
    ['kenan.rustamov', 'Mən də gəlirəm, ilk səfərim olacaq', 1, 9.0],
  ],
};

export const DMS: { a: string; b: string; lines: Line[] }[] = [
  { a: 'reshad.mammadov', b: 'elnur.aliyev', lines: [
    ['reshad.mammadov', 'Elnur, şənbə marşrutun GPX faylını atarsan?', 17, 22.0],
    ['elnur.aliyev', 'Atıram indi. Qayıdışda kəsə yolu da əlavə etmişəm.', 17, 22.2],
    ['reshad.mammadov', 'Əla, sağ ol qardaş', 17, 22.3],
  ] },
  { a: 'aysel.huseynova', b: 'gunay.malikova', lines: [
    ['aysel.huseynova', 'Günay, Altıağac üçün çadırın var?', 5, 14.0],
    ['gunay.malikova', 'Var, amma 3 nəfərlikdir. Sən də sığarsan 🙂', 5, 14.5],
    ['aysel.huseynova', 'Super! Mən də qaz sobası gətirirəm.', 5, 14.8],
    ['gunay.malikova', 'Onda səhər yeməyi məndən', 5, 15.0],
  ] },
  { a: 'orxan.hasanov', b: 'kamran.ismayilov', lines: [
    ['kamran.ismayilov', 'Laza düşərgəsi üçün yer ayırdım, 6 maşın yerləşir.', 12, 10.0],
    ['orxan.hasanov', 'Yaxşı, gözləmə siyahısı da açarıq.', 12, 10.4],
  ] },
  { a: 'ulvi.rahimov', b: 'reshad.mammadov', lines: [
    ['ulvi.rahimov', 'Salam Rəşad müəllim, Pajero Sport üçün hansı təkəri məsləhət görürsünüz?', 6, 19.0],
    ['reshad.mammadov', 'Salam Ülvi. Başlanğıc üçün yaxşı AT kifayətdir, Geolandar və ya KO2.', 6, 19.6],
    ['ulvi.rahimov', 'Geolandar aldım, 2300 manata 👍', 3, 12.0],
  ] },
  { a: 'aynur.sadiqova', b: 'aysel.huseynova', lines: [
    ['aynur.sadiqova', 'Salam Aysel xanım, Santa Fe ilə qum təpələrinə getmək olar?', 9, 11.0],
    ['aysel.huseynova', 'Salam! Asan hissələrə olar, amma təzyiqi endirin və tək getməyin.', 9, 11.5],
    ['aynur.sadiqova', 'Təşəkkür edirəm, klana sorğu göndərdim 🙂', 9, 11.7],
  ] },
  { a: 'ramil.abbasov', b: 'mahir.ahmadli', lines: [
    ['mahir.ahmadli', 'Ramil, UAZ-ın arxa körpüsü səs salır, ustan var?', 20, 17.0],
    ['ramil.abbasov', 'Mingəçevirdə Vaqif ustaya get, deyərsən məndən.', 20, 17.4],
  ] },
  { a: 'nurlan.babayev', b: 'orxan.hasanov', lines: [
    ['nurlan.babayev', 'Salam, Batabat yaylasına yayda gəlsəniz, mən qarşılayaram.', 40, 13.0],
    ['orxan.hasanov', 'Çox sağ ol Nurlan, gələn yay mütləq!', 40, 14.1],
  ] },
];

export const GROUPS: { name: string; admin: string; members: string[]; daysAgo: number; lines: Line[] }[] = [
  {
    name: 'Şahdağ komandası', admin: 'elnur.aliyev', members: ['reshad.mammadov', 'cavid.bagirov', 'murad.kazimov', 'xeyal.allahverdiyev'], daysAgo: 9,
    lines: [
      ['elnur.aliyev', 'Bu qrup ancaq Şahdağ səfəri üçün. Yük siyahısı burada.', 9, 20.0],
      ['cavid.bagirov', 'Mən dartma kəndiri və şaxel gətirirəm.', 9, 20.4],
      ['xeyal.allahverdiyev', 'Qubada yanacaq dolduraq, yuxarıda yoxdur.', 8, 9.0],
      ['murad.kazimov', 'Benzinim 100 km çatır, kanistr də götürürəm.', 8, 9.5],
      ['reshad.mammadov', 'Hava proqnozu yaxşıdır, səhər 6:00-da Sumqayıt dairəsi.', 4, 21.0],
      ['elnur.aliyev', 'Hamıya sağ olun, sağ-salamat qayıtdıq 🏔️', 2, 20.0],
    ],
  },
  {
    name: 'Qadın sürücülər 4x4', admin: 'aysel.huseynova', members: ['gunay.malikova', 'leyla.rzayeva', 'nigar.karimova', 'sabina.ahmadova', 'lale.nagiyeva', 'aynur.sadiqova'], daysAgo: 21,
    lines: [
      ['aysel.huseynova', 'Qızlar, öz qrupumuzu açdım! Sual, məsləhət, birgə səfər — hər şey burada.', 21, 18.0],
      ['nigar.karimova', 'Nə gözəl fikir! Gəncədən salam 👋', 21, 18.5],
      ['lale.nagiyeva', 'Jimny-də bucurqad lazımdır, yoxsa kəndir kifayətdir?', 15, 12.0],
      ['leyla.rzayeva', 'Tək getmirsənsə, kəndir və şaxel bəs edir. Amma qısa kəndir götürmə.', 15, 12.6],
      ['sabina.ahmadova', 'Marxal yaylasını əlavə etdim, çox gözəl yerdir.', 2, 11.0],
      ['aynur.sadiqova', 'Bir gün birlikdə Lökbatana gedək? Mən hələ yeniyəm 🙂', 1, 19.0],
      ['gunay.malikova', 'Əlbəttə! Bazar günü olar?', 1, 19.3],
    ],
  },
];

export type DemoEvent = {
  organizer: string;
  title: string;
  description: string;
  spot: string;
  /** past: negative days ago; upcoming: days ahead. Baku local start hour. */
  day: number;
  hour: number;
  hours: number;
  maxCars: number;
  minDifficulty?: number;
  requirements: string[];
  visibility?: 'public' | 'clan';
  going: string[];
  waitlist?: string[];
  lines?: Line[];
};

export const EVENTS: DemoEvent[] = [
  // ---- past (finished) ----
  {
    organizer: 'reshad.mammadov', title: 'Şənbə Xızı turu', spot: 'Xızı — Qırmızı-ağ dağlar', day: -15, hour: 8, hours: 9, maxCars: 10, minDifficulty: 3,
    requirements: ['4WD', 'Ratsiya', 'AT təkərlər'],
    description: 'Sumqayıt dairəsində 07:30 görüş. Zolaqlı dağlar, nahar Xızıda. Yağış olsa, tur təxirə salınır.',
    going: ['elnur.aliyev', 'leyla.rzayeva', 'vuqar.safarov', 'cavid.bagirov', 'murad.kazimov', 'ilkin.zeynalov'],
    lines: [
      ['reshad.mammadov', 'Sabah 07:30, gecikməyin. Ratsiya kanal 7.', 16, 21.0],
      ['leyla.rzayeva', 'Hazıram!', 16, 21.4],
      ['vuqar.safarov', 'Yoldayam, 10 dəqiqəyə çatıram', 15, 7.4],
      ['reshad.mammadov', 'Hamıya sağ olun, əla gün idi!', 15, 18.5],
    ],
  },
  {
    organizer: 'aysel.huseynova', title: 'Qobustan — ailəvi səfər', spot: 'Qobustan palçıq vulkanları', day: -26, hour: 10, hours: 6, maxCars: 12, minDifficulty: 1,
    requirements: ['Ailəvi'],
    description: 'Yeni başlayanlar və ailələr üçün asan tur. Uşaqlarınızı gətirin, vulkanları birlikdə görək.',
    going: ['tural.quliyev', 'gunay.malikova', 'emin.qasimov', 'aynur.sadiqova', 'fuad.valiyev'],
    lines: [
      ['aysel.huseynova', 'Görüş Ələt yol ayrıcında, 09:45.', 27, 20.0],
      ['aynur.sadiqova', 'İlk səfərimdir, çox həyəcanlıyam 🙂', 27, 20.5],
      ['tural.quliyev', 'Narahat olma, asan yoldur.', 27, 20.8],
    ],
  },
  {
    organizer: 'orxan.hasanov', title: 'Laza şəlalələri — payız düşərgəsi', spot: 'Laza şəlalələri düşərgəsi', day: -33, hour: 9, hours: 32, maxCars: 10,
    requirements: ['4WD', 'Çadır', 'İsti geyim'],
    description: 'İki günlük düşərgə. Şəlalələrə piyada gəzinti, axşam ocaq başında plov.',
    going: ['kamran.ismayilov', 'nigar.karimova', 'anar.mustafayev', 'zaur.haciyev', 'rauf.asgarov', 'parviz.humbatov'],
    lines: [
      ['orxan.hasanov', 'Plov üçün qazan məndə, düyü kimdə?', 34, 19.0],
      ['rauf.asgarov', 'Düyü və fındıq məndən', 34, 19.5],
      ['nigar.karimova', 'Gecə çox soyuq olacaq, yataq kisələrini unutmayın', 34, 20.2],
    ],
  },
  {
    organizer: 'kamran.ismayilov', title: 'Qəbələ–Laza aşırımı', spot: 'Qəbələ–Laza aşırımı', day: -45, hour: 8, hours: 10, maxCars: 8, minDifficulty: 3,
    requirements: ['4WD', 'Aşağı ötürücü'],
    description: 'Mövsümün son aşırım turu. Qardan əvvəl son şans.',
    going: ['orxan.hasanov', 'rauf.asgarov', 'nurlan.babayev', 'zaur.haciyev'],
  },
  {
    organizer: 'ramil.abbasov', title: 'Niva gecə turu — Abşeron qumları', spot: 'Abşeron qum təpələri', day: -5, hour: 19, hours: 4, maxCars: 8, minDifficulty: 2,
    requirements: ['4WD', 'Fənər', 'Kompressor'],
    description: 'Ay işığında qum təpələri. Təzyiqi endiririk, sonra çay və şaşlık.',
    going: ['elcin.cafarov', 'sabina.ahmadova', 'mahir.ahmadli', 'kenan.rustamov'],
    lines: [
      ['ramil.abbasov', 'Görüş 18:30 Novxanı dairəsində.', 6, 20.0],
      ['kenan.rustamov', 'İlk turumdur, kompressorum yoxdur 😬', 6, 20.4],
      ['elcin.cafarov', 'Məndə var, paylaşarıq', 6, 20.6],
      ['sabina.ahmadova', 'Super gecə idi, sağ olun!', 5, 23.8],
    ],
  },
  {
    organizer: 'elnur.aliyev', title: 'Şahdağ yaylasına çıxış', spot: 'Şahdağ yaylası yolu', day: -3, hour: 7, hours: 10, maxCars: 8, minDifficulty: 4,
    requirements: ['4WD', 'Lift', 'Bucurqad', 'Ratsiya'],
    description: 'Ancaq hazır maşınlar. Yolda 3 çay keçidi var. Qubada yanacaq doldururuq.',
    going: ['reshad.mammadov', 'xeyal.allahverdiyev', 'cavid.bagirov', 'murad.kazimov', 'fuad.valiyev'],
    lines: [
      ['elnur.aliyev', 'Səhər 06:00 Sumqayıt dairəsi. Ratsiya kanal 7.', 4, 21.5],
      ['fuad.valiyev', 'Wrangler hazırdır 💪', 4, 22.0],
      ['xeyal.allahverdiyev', 'Qubada sizi gözləyirəm', 3, 8.4],
      ['cavid.bagirov', 'Çay keçidində Muradı dartdıq, hər şey qaydasındadır', 3, 13.2],
      ['elnur.aliyev', 'Hamı sağ-salamat evdədir? Təşəkkürlər, komanda!', 3, 21.0],
    ],
  },
  // ---- upcoming ----
  {
    organizer: 'reshad.mammadov', title: 'Səhər Xızı turu — yeni marşrut', spot: 'Xızı — Qırmızı-ağ dağlar', day: 8, hour: 8, hours: 8, maxCars: 10, minDifficulty: 3,
    requirements: ['4WD', 'Ratsiya'],
    description: 'Zolaqlı dağların şərq tərəfi, keçən dəfə getmədiyimiz yol. Yeni üzvlər də xoş gəlir.',
    going: ['leyla.rzayeva', 'ulvi.rahimov', 'emin.qasimov'],
    lines: [['reshad.mammadov', 'Hava proqnozuna baxıb cümə günü təsdiq edəcəm.', 1, 20.0]],
  },
  {
    organizer: 'orxan.hasanov', title: 'Laza düşərgəsi — 2 gün', spot: 'Xınalıq yaylası düşərgəsi', day: 15, hour: 9, hours: 30, maxCars: 6,
    requirements: ['4WD', 'Çadır', 'İsti geyim'],
    description: 'Qışdan əvvəl son yayla düşərgəsi. Yer azdır, gözləmə siyahısı açıqdır.',
    going: ['kamran.ismayilov', 'nigar.karimova', 'anar.mustafayev', 'togrul.abdullayev', 'rauf.asgarov'],
    waitlist: ['parviz.humbatov', 'nurlan.babayev'],
    lines: [
      ['orxan.hasanov', 'Yerlər doldu, gözləmə siyahısındakılar hazır olsun.', 2, 19.0],
      ['parviz.humbatov', 'Kimsə imtina etsə, mən hazıram!', 2, 19.4],
    ],
  },
  {
    organizer: 'tural.quliyev', title: 'Altıağac meşə gecəsi', spot: 'Altıağac meşə düşərgəsi', day: 4, hour: 17, hours: 18, maxCars: 5,
    requirements: ['4WD', 'Çadır', 'Fənər'],
    description: 'Meşədə gecələmə, ocaq və ulduzlar. Odunu özümüzlə gətiririk.',
    going: ['aysel.huseynova', 'gunay.malikova', 'samir.novruzov', 'emin.qasimov'],
    waitlist: ['fuad.valiyev'],
    lines: [
      ['tural.quliyev', 'Siyahı doldu. Kompressor və odun kimdədir?', 4, 11.0],
      ['gunay.malikova', 'Odun məndən', 4, 11.5],
    ],
  },
  {
    organizer: 'elnur.aliyev', title: 'DMK klan gəzintisi: Beşbarmaq', spot: 'Beşbarmaq dağı ətəyi', day: 9, hour: 9, hours: 7, maxCars: 12, minDifficulty: 3,
    requirements: ['4WD', 'Ratsiya'],
    visibility: 'clan',
    description: 'Ancaq Dəmir Karvan üzvləri üçün. Yeni üzvləri tanıdırıq, axşam birgə şam yeməyi.',
    going: ['reshad.mammadov', 'leyla.rzayeva', 'ulvi.rahimov', 'xeyal.allahverdiyev'],
  },
  {
    organizer: 'ramil.abbasov', title: 'Niva Klubu: Naftalan yolları', spot: 'Naftalan çölləri', day: 11, hour: 10, hours: 6, maxCars: 15, minDifficulty: 1,
    requirements: ['Niva / UAZ xoşdur'],
    description: 'Asan çöl yolları, yeni başlayanlar üçün. Sonra Naftalanda nahar.',
    going: ['mahir.ahmadli', 'kenan.rustamov'],
  },
  {
    organizer: 'zaur.haciyev', title: 'Talış dağları — Lerik səfəri', spot: 'Lerik dağ yolu', day: 22, hour: 8, hours: 34, maxCars: 8, minDifficulty: 3,
    requirements: ['4WD', 'AT təkərlər', 'Çadır'],
    description: 'İki günlük Talış səfəri: Lerik yolu, meşə düşərgəsi və çay bağları.',
    going: ['rauf.asgarov', 'nigar.karimova'],
    lines: [['zaur.haciyev', 'Lənkəranda görüşürük, ünvanı sonra atacam.', 3, 14.0]],
  },
];

/** Pending friend requests (from, to). */
export const FRIEND_REQUESTS: [string, string][] = [
  ['aynur.sadiqova', 'tural.quliyev'],
  ['shahin.yusifov', 'reshad.mammadov'],
  ['lale.nagiyeva', 'vuqar.safarov'],
  ['kenan.rustamov', 'kamran.ismayilov'],
];
