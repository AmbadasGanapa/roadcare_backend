const mongoose = require('mongoose');

const citizenInfoSchema = new mongoose.Schema(
  {
    citizenId: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    contactNo: {
      type: String,
      required: true,
      trim: true,
    },
    dob: {
      type: String,
      default: '',
      trim: true,
    },
    city: {
      type: String,
      default: '',
      trim: true,
    },
    taluka: {
      type: String,
      default: '',
      trim: true,
    },
    occupation: {
      type: String,
      default: '',
      trim: true,
    },
    address: {
      type: String,
      default: '',
      trim: true,
    },
    img: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'citizenInfo',
  },
);

citizenInfoSchema.index({ citizenId: 1 }, { unique: true });
citizenInfoSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('CitizenInfo', citizenInfoSchema);
