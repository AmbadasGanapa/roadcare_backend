const dotenv = require('dotenv');
const mongoose = require('mongoose');

const FeedPost = require('../models/feed_post');

dotenv.config();

const samplePosts = [
  {
    name: 'Isha Patel',
    contactNumber: '9876543210',
    email: 'isha@example.com',
    damageType: 'Road Crack',
    description: 'Cracks spreading across the lane near the park.',
    address: 'DLF Phase 3, Gurugram',
    imageUrl: '',
  },
  {
    name: 'Rohan Mehta',
    contactNumber: '9988776655',
    email: 'rohan@example.com',
    damageType: 'Debris',
    description: 'Construction debris blocking half the road.',
    address: 'Andheri East, Mumbai',
    imageUrl: '',
  },
  {
    name: 'Priya Nair',
    contactNumber: '9090909090',
    email: 'priya@example.com',
    damageType: 'Pothole',
    description: 'Deep pothole near the bus stop causing slowdowns.',
    address: 'Kakkanad, Kochi',
    imageUrl: '',
  },
];

async function seed() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Add it to backend/backend/.env');
  }

  await mongoose.connect(mongoUri);
  await FeedPost.deleteMany({});
  await FeedPost.insertMany(samplePosts);
  console.log(`Seeded ${samplePosts.length} feed posts.`);
  await mongoose.disconnect();
}

seed().catch((error) => {
  console.error('Feed seed failed', error);
  process.exit(1);
});
