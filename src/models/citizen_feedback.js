const mongoose = require('mongoose');

const citizenFeedbackSchema = new mongoose.Schema(
  {
    feedbackId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    citizenId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    thoughts: {
      type: String,
      default: '',
      trim: true,
    },
    followUp: {
      type: String,
      required: true,
      enum: ['yes', 'no'],
      lowercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'citizenfeedback',
  },
);

module.exports = mongoose.model('CitizenFeedback', citizenFeedbackSchema);
