// What the media library looks for. CLIP compares each picture with these
// phrases ("a photo of …"), so any wording works and the lists are easy to
// extend. Written for Scorpion (no list is taken from other projects).

// [category, label, prompt?] — the prompt defaults to the label.
export const OBJECTS = [
  // Animals
  ['Animals', 'dog'], ['Animals', 'cat'], ['Animals', 'bird'], ['Animals', 'horse'], ['Animals', 'cow'], ['Animals', 'goat'],
  ['Animals', 'pig'], ['Animals', 'chicken'], ['Animals', 'fish', 'a fish'], ['Animals', 'insect', 'an insect'], ['Animals', 'butterfly'],
  ['Animals', 'monkey'], ['Animals', 'elephant'], ['Animals', 'lion'], ['Animals', 'tiger'], ['Animals', 'bear'], ['Animals', 'deer'],
  ['Animals', 'rabbit'], ['Animals', 'snake'], ['Animals', 'turtle'], ['Animals', 'dolphin'], ['Animals', 'whale'], ['Animals', 'giraffe'],
  ['Animals', 'zebra'], ['Animals', 'sheep'], ['Animals', 'duck'], ['Animals', 'parrot'], ['Animals', 'scorpion'], ['Animals', 'spider'],
  // Food & drink
  ['Food', 'fruit'], ['Food', 'vegetables'], ['Food', 'pizza'], ['Food', 'burger', 'a hamburger'], ['Food', 'cake'], ['Food', 'bread'],
  ['Food', 'rice dish', 'a plate of rice'], ['Food', 'pasta'], ['Food', 'salad'], ['Food', 'soup'], ['Food', 'sushi'], ['Food', 'meat', 'grilled meat'],
  ['Food', 'seafood'], ['Food', 'sandwich'], ['Food', 'dessert'], ['Food', 'ice cream'], ['Food', 'coffee', 'a cup of coffee'], ['Food', 'drink', 'a glass of a drink'],
  ['Food', 'wine', 'a glass of wine'], ['Food', 'beer', 'a glass of beer'], ['Food', 'meal', 'a plate of food'], ['Food', 'breakfast'],
  // Vehicles
  ['Vehicles', 'car'], ['Vehicles', 'truck'], ['Vehicles', 'bus'], ['Vehicles', 'motorcycle'], ['Vehicles', 'bicycle'], ['Vehicles', 'airplane'],
  ['Vehicles', 'helicopter'], ['Vehicles', 'train'], ['Vehicles', 'boat'], ['Vehicles', 'ship'], ['Vehicles', 'tractor'], ['Vehicles', 'race car'],
  // Buildings
  ['Buildings', 'house'], ['Buildings', 'apartment building'], ['Buildings', 'skyscraper'], ['Buildings', 'church'], ['Buildings', 'mosque'],
  ['Buildings', 'temple'], ['Buildings', 'castle'], ['Buildings', 'bridge'], ['Buildings', 'stadium'], ['Buildings', 'school'], ['Buildings', 'office'],
  ['Buildings', 'shop', 'a shop front'], ['Buildings', 'ruins'], ['Buildings', 'lighthouse'], ['Buildings', 'tower'],
  // Landscapes & nature
  ['Landscapes', 'beach'], ['Landscapes', 'sea', 'the ocean'], ['Landscapes', 'mountains'], ['Landscapes', 'forest'], ['Landscapes', 'lake'],
  ['Landscapes', 'river'], ['Landscapes', 'waterfall'], ['Landscapes', 'desert'], ['Landscapes', 'snow', 'a snowy landscape'], ['Landscapes', 'field', 'a green field'],
  ['Landscapes', 'garden'], ['Landscapes', 'park'], ['Landscapes', 'sunset'], ['Landscapes', 'night sky', 'the night sky with stars'],
  ['Landscapes', 'clouds', 'clouds in the sky'], ['Landscapes', 'city', 'a city skyline'], ['Landscapes', 'street', 'a city street'],
  ['Landscapes', 'countryside'], ['Landscapes', 'island'], ['Landscapes', 'flowers'], ['Landscapes', 'tree', 'a tree'],
  // People & events
  ['People', 'portrait', 'a portrait of a person'], ['People', 'selfie'], ['People', 'group photo', 'a group of people'], ['People', 'baby'],
  ['People', 'children'], ['People', 'crowd'], ['Events', 'wedding'], ['Events', 'birthday party'], ['Events', 'party'], ['Events', 'concert'],
  ['Events', 'graduation'], ['Events', 'christmas', 'Christmas decorations'], ['Events', 'carnival', 'a carnival parade'], ['Events', 'church service'],
  // Sports
  ['Sports', 'soccer', 'people playing soccer'], ['Sports', 'basketball', 'people playing basketball'], ['Sports', 'swimming pool'],
  ['Sports', 'gym', 'a gym'], ['Sports', 'running', 'people running a race'], ['Sports', 'tennis', 'people playing tennis'],
  // Things & places indoors
  ['Things', 'computer', 'a computer'], ['Things', 'phone', 'a smartphone'], ['Things', 'television'], ['Things', 'book', 'books'],
  ['Things', 'furniture'], ['Things', 'kitchen'], ['Things', 'bedroom'], ['Things', 'living room'], ['Things', 'office desk'],
  ['Things', 'clothes'], ['Things', 'shoes'], ['Things', 'jewelry'], ['Things', 'toys'], ['Things', 'musical instrument', 'a musical instrument'],
  ['Things', 'guitar'], ['Things', 'piano'], ['Things', 'drum', 'drums'], ['Things', 'money', 'money and banknotes'], ['Things', 'tools', 'hand tools'],
  // Art & documents
  ['Art', 'painting', 'a painting'], ['Art', 'drawing', 'a drawing'], ['Art', 'sculpture'], ['Art', 'graffiti'], ['Art', 'logo', 'a logo'],
  ['Documents', 'document', 'a printed document'], ['Documents', 'receipt'], ['Documents', 'screenshot', 'a screenshot of a computer screen'],
  ['Documents', 'handwriting', 'handwritten notes'], ['Documents', 'map', 'a map'], ['Documents', 'chart', 'a chart or graph'],
  ['Documents', 'id card', 'an identity card'], ['Documents', 'whiteboard'], ['Documents', 'meme', 'a meme with text'],
];

// Landmarks and monuments. Listed separately: a picture is a landmark only
// when one of these clearly wins against ordinary scenes (see NOT_LANDMARK).
export const LANDMARKS = [
  'Eiffel Tower', 'Statue of Liberty', 'Taj Mahal', 'Great Wall of China', 'Colosseum', 'Leaning Tower of Pisa', 'Big Ben', 'Tower Bridge',
  'Golden Gate Bridge', 'Sydney Opera House', 'Christ the Redeemer', 'Machu Picchu', 'Pyramids of Giza', 'Great Sphinx of Giza', 'Petra',
  'Stonehenge', 'Acropolis of Athens', 'Sagrada Familia', 'Arc de Triomphe', 'Louvre Pyramid', 'Notre-Dame de Paris', 'Mont Saint-Michel',
  'Brandenburg Gate', 'Neuschwanstein Castle', 'Kremlin', "Saint Basil's Cathedral", 'Burj Khalifa', 'Empire State Building',
  'Times Square', 'White House', 'United States Capitol', 'Lincoln Memorial', 'Mount Rushmore', 'Hollywood Sign', 'Space Needle',
  'CN Tower', 'Niagara Falls', 'Grand Canyon', 'Chichen Itza', 'Angkor Wat', 'Forbidden City', 'Tokyo Tower', 'Mount Fuji',
  'Fushimi Inari Shrine', 'Petronas Towers', 'Marina Bay Sands', 'Hagia Sophia', 'Blue Mosque', 'Alhambra', 'Burj Al Arab',
  'Sheikh Zayed Grand Mosque', 'Moai statues of Easter Island', 'Victoria Falls', 'Table Mountain', 'Kilimanjaro', 'Matterhorn',
  'Westminster Abbey', 'Buckingham Palace', 'Edinburgh Castle', 'Trevi Fountain', "St. Peter's Basilica", 'Florence Cathedral',
  'Rialto Bridge in Venice', 'Atomium', 'Windmills of Kinderdijk', 'Charles Bridge in Prague', 'Parliament of Budapest',
  'Gateway Arch', 'Lady Liberty in Paris', 'Citadelle Laferrière', 'Sans-Souci Palace in Milot', 'Cathedral of Port-au-Prince',
  'Bassin Bleu', 'Labadee beach', 'El Morro in San Juan', 'Havana Capitol', 'Panama Canal', 'Teotihuacan pyramids', 'Uluru',
  'Golden Temple of Amritsar', 'India Gate', 'Gateway of India', 'Wat Arun', 'Shwedagon Pagoda', 'Borobudur', 'Ha Long Bay',
];
export const NOT_LANDMARK = ['an ordinary building', 'an ordinary street', 'a person', 'a room indoors', 'nature without buildings', 'food', 'a vehicle', 'a document', 'an animal'];

// Human actions for videos (CLIP looks at a few frames of each video).
export const ACTIONS = [
  'dancing', 'singing', 'playing guitar', 'playing piano', 'playing drums', 'cooking', 'eating', 'drinking', 'running', 'walking',
  'jumping', 'swimming', 'surfing', 'skiing', 'snowboarding', 'skateboarding', 'riding a bicycle', 'riding a horse', 'driving a car',
  'playing soccer', 'playing basketball', 'playing tennis', 'boxing', 'doing yoga', 'lifting weights', 'climbing', 'hiking', 'fishing',
  'gardening', 'cleaning', 'painting a picture', 'reading', 'typing on a computer', 'talking on the phone', 'giving a speech',
  'laughing', 'hugging', 'kissing', 'clapping', 'playing with a dog', 'feeding animals', 'playing a video game', 'blowing out candles',
  'opening presents', 'taking a selfie', 'teaching a class', 'sleeping', 'crying', 'exercising', 'celebrating',
];
export const NO_ACTION = ['a still scene with nobody moving', 'a landscape', 'an object on a table', 'text on a screen'];

// AudioSet labels (from the audio model) that are music genres.
export const GENRES = [
  'Pop music', 'Hip hop music', 'Rock music', 'Heavy metal', 'Punk rock', 'Grunge', 'Progressive rock', 'Rock and roll', 'Psychedelic rock',
  'Rhythm and blues', 'Soul music', 'Reggae', 'Country', 'Swing music', 'Bluegrass', 'Funk', 'Folk music', 'Middle Eastern music', 'Jazz',
  'Disco', 'Classical music', 'Opera', 'Electronic music', 'House music', 'Techno', 'Dubstep', 'Drum and bass', 'Electronica',
  'Electronic dance music', 'Ambient music', 'Trance music', 'Music of Latin America', 'Salsa music', 'Flamenco', 'Blues',
  'Music for children', 'New-age music', 'Vocal music', 'A capella', 'Music of Africa', 'Afrobeat', 'Christian music', 'Gospel music',
  'Music of Asia', 'Carnatic music', 'Music of Bollywood', 'Ska', 'Traditional music', 'Independent music', 'Lullaby', 'Video game music',
  'Christmas music', 'Dance music', 'Wedding music', 'Soundtrack music', 'Theme music',
];
// Non-music audio worth a tag of its own.
export const SOUNDS = ['Speech', 'Singing', 'Choir', 'Rapping', 'Laughter', 'Applause', 'Crowd', 'Rain', 'Thunderstorm', 'Ocean', 'Bird', 'Dog',
  'Piano', 'Guitar', 'Electric guitar', 'Acoustic guitar', 'Synthesizer', 'Drum kit', 'Violin, fiddle', 'Saxophone', 'Trumpet', 'Orchestra', 'Organ', 'Accordion', 'Flute'];

export const CATEGORIES = ['People', 'Animals', 'Food', 'Vehicles', 'Buildings', 'Landscapes', 'Landmarks', 'Places', 'Events', 'Sports', 'Things', 'Art', 'Documents', 'Actions', 'Genres', 'Sounds'];
