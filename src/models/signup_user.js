const mongoose = require('mongoose');

const signupUserSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    passwordSalt: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
      default: 'citizen',
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'signupCollection',
  },
);

module.exports = mongoose.model('SignupUser', signupUserSchema);
