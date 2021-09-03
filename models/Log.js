const mongoose = require('mongoose');

mongoose.Promise = global.Promise;

const logSchema = new mongoose.Schema({
  created: {
    type: Date,
    default: Date.now,
  },
  type: String,
  author: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
  },
  project: {
    type: mongoose.Schema.ObjectId,
    ref: 'Project',
  },
  test: {
    type: mongoose.Schema.ObjectId,
    ref: 'Test',
  },
});

// define indexes for the faster search
logSchema.index({
  project: 1,
  author: 1,
  test: 1,
});

module.exports = mongoose.model('Log', logSchema);
