export type CampusZone = 'east' | 'west' | 'hostels' | 'academic';

export type CampusLocation = {
  id: string;
  name: string;
  zone: CampusZone;
  description: string;
};

export type CampusCanteen = {
  id: string;
  name: string;
  locationId: string;
  confirmed: boolean;
  description: string;
};

export const campusMapUrl = 'https://ir.nitc.ac.in/uploads/nitc_map_edited.pdf';
export const campusMapImageUrl = '/campus-map.jpg';

export const campusSourceLinks = [
  { title: 'NITC official campus map', url: campusMapUrl },
  {
    title: 'NITC Swagatham 2025 campus guide',
    url: 'https://nitc.ac.in/imgserver/uploads/attachments/swagatham-2025--ug-brochure_0fd7efbb-a23a-4692-939d-80f871d6d5a3_0.pdf',
  },
  {
    title: 'NITC Central Research Facility map',
    url: 'https://www.randc.nitc.ac.in/crf/CRF_Brochure.pdf',
  },
  {
    title: 'Swadishtam reopening with Milma',
    url: 'https://nitc.ac.in/news-and-events/milma039s-first-non-vegetarian-priority-outlet-opens-at-nit-calicut',
  },
  { title: 'NITC hostel names and contacts', url: 'https://nitc.ac.in/hostel-contact' },
  {
    title: 'NITC campus and hostel amenities',
    url: 'https://ir.nitc.ac.in/life-at-nitc.php',
  },
];

export const locations: CampusLocation[] = [
  {
    id: 'east-canteen',
    name: 'East Campus Canteen',
    zone: 'east',
    description: 'The CRF map labels this East Camp Canteen. Proposed LunchLine pilot pickup site.',
  },
  {
    id: 'eclhc',
    name: 'East Campus Lecture Hall Complex',
    zone: 'east',
    description: 'First-year lecture complex in East Campus, labelled ECLHC on the official map.',
  },
  {
    id: 'nlhc',
    name: 'New Lecture Hall Complex (NLHC)',
    zone: 'academic',
    description: 'Lecture hall complex in the central academic campus.',
  },
  {
    id: 'lh',
    name: 'Ladies Hostel (LH)',
    zone: 'hostels',
    description: 'Ladies Hostel in West Campus.',
  },
  {
    id: 'mlh',
    name: 'Mega Ladies Hostel (MLH)',
    zone: 'hostels',
    description: 'Mega Ladies Hostel in West Campus.',
  },
  {
    id: 'mbh1',
    name: 'Mega Boys Hostel 1',
    zone: 'hostels',
    description: 'West Campus hostel labelled on the official map.',
  },
  {
    id: 'mbh2',
    name: 'Mega Boys Hostel 2',
    zone: 'hostels',
    description: 'West Campus hostel labelled on the official map.',
  },
  {
    id: 'hostel-a',
    name: 'A Hostel',
    zone: 'hostels',
    description: 'Central Campus hostel.',
  },
  {
    id: 'hostel-b',
    name: 'B Hostel',
    zone: 'hostels',
    description: 'Central Campus hostel.',
  },
  {
    id: 'hostel-c',
    name: 'C Hostel',
    zone: 'hostels',
    description: 'Central Campus hostel.',
  },
  {
    id: 'hostel-d',
    name: 'D Hostel',
    zone: 'hostels',
    description: 'Central Campus hostel.',
  },
  {
    id: 'hostel-e',
    name: 'E Hostel',
    zone: 'hostels',
    description: 'Central Campus hostel.',
  },
  {
    id: 'hostel-f',
    name: 'F Hostel',
    zone: 'hostels',
    description: 'Central Campus hostel.',
  },
  {
    id: 'hostel-g',
    name: 'G Hostel',
    zone: 'hostels',
    description: 'Central Campus hostel.',
  },
  {
    id: 'pg1',
    name: 'PG Hostel 1',
    zone: 'hostels',
    description: 'Central Campus postgraduate hostel.',
  },
  {
    id: 'pg2',
    name: 'PG Hostel 2',
    zone: 'hostels',
    description: 'Central Campus postgraduate hostel.',
  },
  {
    id: 'main-canteen',
    name: 'Swadishtam Main Canteen',
    zone: 'academic',
    description: 'Named central-campus canteen in the NITC campus guide.',
  },
  {
    id: 'samthrupthi-canteen',
    name: 'Samthrupthi Canteen',
    zone: 'academic',
    description: 'Named central-campus canteen in the NITC campus guide.',
  },
  {
    id: 'maitri-cafeteria',
    name: 'Maitri Cafeteria',
    zone: 'academic',
    description: 'Named central-campus cafeteria in the NITC campus guide.',
  },
  {
    id: 'students-amenity-centre',
    name: 'Students Amenity Centre',
    zone: 'academic',
    description: 'Also called Suvidha Kendra in the campus guide.',
  },
  {
    id: 'old-library-cafeteria',
    name: 'Old Library / Cafeteria',
    zone: 'academic',
    description: 'Labelled as infrastructure point 20 on the official map.',
  },
  {
    id: 'central-library',
    name: 'Central Library',
    zone: 'west',
    description: 'Library in West Campus.',
  },
  {
    id: 'east-gate',
    name: 'East Campus Gate',
    zone: 'east',
    description: 'Named campus entrance on the official map.',
  },
  {
    id: 'west-gate',
    name: 'West Campus Gate',
    zone: 'west',
    description: 'Named campus entrance on the official map.',
  },
];

// Confirmed records have an official source for the outlet's existence.
// LunchLine participation is established separately from this directory.
export const canteens: CampusCanteen[] = [
  {
    id: 'east-campus',
    name: 'East Campus Canteen',
    locationId: 'east-canteen',
    confirmed: true,
    description: 'Documented as East Camp Canteen in NITC’s CRF brochure. Proposed LunchLine pilot pickup site.',
  },
  {
    id: 'swadishtam',
    name: 'Swadishtam Main Canteen',
    locationId: 'main-canteen',
    confirmed: true,
    description: 'NITC announced its reopening with Milma in July 2025, serving vegetarian and non-vegetarian food. Directory listing.',
  },
  {
    id: 'samthrupthi',
    name: 'Samthrupthi Canteen',
    locationId: 'samthrupthi-canteen',
    confirmed: true,
    description: 'Listed as Samthrupthi Canteen (Milma) in NITC’s 2025 campus guide. Directory listing.',
  },
  {
    id: 'maitri',
    name: 'Maitri Cafeteria',
    locationId: 'maitri-cafeteria',
    confirmed: true,
    description: 'Named in NITC’s 2025 campus guide. Directory listing.',
  },
  {
    id: 'lh-night-canteen',
    name: 'Ladies Hostel Night Canteen',
    locationId: 'lh',
    confirmed: true,
    description: 'NITC lists a night canteen among the Ladies Hostel amenities. Directory listing.',
  },
];
