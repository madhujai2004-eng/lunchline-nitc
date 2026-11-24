import type { Metadata } from 'next';
import { campusMapUrl } from '../campus';

export const metadata: Metadata = {
  title: 'Photo credits · LunchLine',
};

const photographs = [
  {
    food: 'Lime drink',
    title: 'Lime juice on drinking glass beside sliced limes',
    photographer: 'Francesca Hotchin',
    source: 'https://unsplash.com/photos/lime-juice-on-drinking-glass-beside-sliced-limes-p5EiqkBYIEE',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
  },
  {
    food: 'Overnight oats',
    title: 'A bowl of oatmeal and a spoon on a seat',
    photographer: 'M. Cooper',
    source: 'https://unsplash.com/photos/a-bowl-of-oatmeal-and-a-spoon-on-a-seat-Tf-tcWcYSVc',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
  },
  {
    food: 'Protein bites',
    title: 'Cranberry energy balls',
    photographer: 'Ophélie Pgt',
    source: 'https://unsplash.com/photos/a-bowl-filled-with-fruit-and-nuts-next-to-a-bowl-of-granola-miuSVZ10T3c',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
  },
  {
    food: 'Vegetable meal bowl',
    title: 'Vegan salad bowl',
    photographer: 'Anna Pelzer',
    source: 'https://unsplash.com/photos/bowl-of-vegetable-salads-IGfIGP5ONV0',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
  },
  {
    food: 'Chicken rice bowl',
    title: 'Healthy chicken and rice bowl with fresh vegetables',
    photographer: 'joe boshra',
    source: 'https://unsplash.com/photos/healthy-chicken-and-rice-bowl-with-fresh-vegetables-tB2MPTiSrsg',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
  },
  {
    food: 'Chicken biryani',
    title: 'A white bowl filled with rice and meat',
    photographer: 'Mario Raj',
    source: 'https://unsplash.com/photos/a-white-bowl-filled-with-rice-and-meat-ysmeQt1dzcw',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
  },
  {
    food: 'Vegetable biryani',
    title: 'Vegetable Biryani',
    photographer: 'Miansari66',
    source: 'https://commons.wikimedia.org/wiki/File:Vegetable_Biryani.JPG',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  {
    food: 'South Indian meals',
    title: 'Indian thalis with rice and a variety of dishes',
    photographer: 'Zoshua Colah',
    source: 'https://unsplash.com/photos/indian-thalis-with-rice-and-a-variety-of-dishes-adzbTddUg68',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
  },
  {
    food: 'Samosa',
    title: 'Golden fried samosas served on a white napkin',
    photographer: 'Mohammad Fahim',
    source: 'https://unsplash.com/photos/golden-fried-samosas-served-on-a-white-napkin-iaEZgGPnEwo',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
  },
  {
    food: 'Ice cream',
    title: 'Two scoops of ice cream in a white bowl',
    photographer: 'carlos lugo',
    source: 'https://unsplash.com/photos/two-scoops-of-ice-cream-in-a-white-bowl-a7B4MtrNycM',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
  },
];

export default function PhotoCredits() {
  return (
    <main style={{ minHeight: '100vh', background: '#133d32', color: '#fff', padding: '36px 24px 64px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <a href="/" style={{ display: 'inline-block', color: '#fff', textDecoration: 'none', fontWeight: 800, fontSize: 24 }}>
          LunchLine
        </a>
        <h1 style={{ margin: '48px 0 10px', fontSize: 'clamp(30px, 5vw, 44px)', lineHeight: 1.1, letterSpacing: '-1px' }}>
          Photo credits
        </h1>
        <p style={{ color: '#d3e3d9', maxWidth: 620, marginBottom: 28 }}>
          These photographs illustrate the pilot menu. Actual items may vary.
          {' '}The vegetable puff image was generated with AI for this pilot.
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, background: '#fff', color: '#183b31', borderRadius: 20, overflow: 'hidden' }}>
          {photographs.map((photo) => (
            <li key={photo.food} style={{ padding: '20px 24px', borderBottom: '1px solid #dfe7e0' }}>
              <h2 style={{ fontSize: 17, fontWeight: 750, marginBottom: 4 }}>{photo.food}</h2>
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>
                <a href={photo.source} target="_blank" rel="noreferrer" style={{ textUnderlineOffset: 3 }}>
                  {photo.title}
                </a>
                {' by '}{photo.photographer}.
              </p>
              <p style={{ fontSize: 13, color: '#52675b', marginTop: 4 }}>
                <a href={photo.licenseUrl} target="_blank" rel="noreferrer" style={{ textUnderlineOffset: 3 }}>
                  {photo.license}
                </a>
              </p>
            </li>
          ))}
        </ul>
        <section style={{ marginTop: 28, color: '#d3e3d9' }}>
          <h2 style={{ color: '#fff', fontSize: 19, marginBottom: 8 }}>Campus map</h2>
          <p style={{ fontSize: 14 }}>
            Official NIT Calicut campus map, credited in the PDF to Thunuguntla Sai Harshith.
            The app preview was rendered from the{' '}
            <a href={campusMapUrl} target="_blank" rel="noreferrer" style={{ textUnderlineOffset: 3 }}>
              original map published by NITC’s Office of International Relations
            </a>.
          </p>
        </section>
        <a href="/" style={{ display: 'inline-block', marginTop: 28, color: '#fff', textUnderlineOffset: 4 }}>
          Back to the menu
        </a>
      </div>
    </main>
  );
}
