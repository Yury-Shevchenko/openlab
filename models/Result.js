const mongoose = require('mongoose');

mongoose.Promise = global.Promise;

const resultSchema = new mongoose.Schema({
  created: {
    type: Date,
    default: Date.now,
  },
  author: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: 'You must supply a user!',
  },
  project: {
    type: mongoose.Schema.ObjectId,
    ref: 'Project',
  },
  test: {
    type: mongoose.Schema.ObjectId,
    ref: 'Test',
    required: 'You must supply a test!',
  },
  taskslug: String,
  transfer: String,
  uploadType: String,
  result: mongoose.Schema.Types.Mixed,
  parameters: mongoose.Schema.Types.Mixed,
  meta: mongoose.Schema.Types.Mixed,
  keys: mongoose.Schema.Types.Mixed,
  rawdata: mongoose.Schema.Types.Mixed,
  aggregated: mongoose.Schema.Types.Mixed,
  deleteRequest: {
    type: Boolean,
    default: false,
  },
  dataRequest: {
    type: Boolean,
    default: false,
  },
  openDataForParticipant: {
    type: Boolean,
    default: false,
  },
  storage: {
    type: String,
    default: 'OL',
  },
});

// get results of particular user
resultSchema.statics.getUserResults = function (feature) {
  return this.aggregate([
    { $match: { rawdata: { $exists: true } } },
    { $match: { project: mongoose.Types.ObjectId(feature.project) } },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'author',
      },
    },
    { $match: { 'author._id': mongoose.Types.ObjectId(feature.author) } },
    {
      $lookup: {
        from: 'tests',
        localField: 'test',
        foreignField: '_id',
        as: 'originTest',
      },
    },
    {
      $lookup: {
        from: 'projects',
        localField: 'project',
        foreignField: '_id',
        as: 'originProject',
      },
    },
    {
      $project: {
        created: '$$ROOT.created',
        project_name: '$$ROOT.originProject.name',
        participant_id: '$$ROOT.author.openLabId',
        participant_name: '$$ROOT.author.name',
        participant_code: '$$ROOT.author.code.id',
        user_id: '$$ROOT.author._id',
        test: '$$ROOT.test',
        name: '$$ROOT.originTest.name',
        slug: '$$ROOT.originTest.slug',
        uploadType: '$$ROOT.uploadType',
        fileSize: { $size: '$$ROOT.rawdata' },
        deleteRequest: '$$ROOT.deleteRequest',
        dataRequest: '$$ROOT.dataRequest',
        openDataForParticipant: '$$ROOT.openDataForParticipant',
        aggregated: '$$ROOT.aggregated',
      },
    },
    { $sort: { created: 1 } },
  ]);
};

// get results of particular user
resultSchema.statics.getFullResults = function (feature) {
  return this.aggregate([
    { $match: { uploadType: 'full' } },
    { $match: { project: mongoose.Types.ObjectId(feature.project) } },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'author',
      },
    },
    { $match: { 'author._id': mongoose.Types.ObjectId(feature.author) } },
    {
      $lookup: {
        from: 'tests',
        localField: 'test',
        foreignField: '_id',
        as: 'originTest',
      },
    },
    {
      $lookup: {
        from: 'projects',
        localField: 'project',
        foreignField: '_id',
        as: 'originProject',
      },
    },
    {
      $project: {
        created: '$$ROOT.created',
        project_name: '$$ROOT.originProject.name',
        participant_id: '$$ROOT.author.openLabId',
        participant_name: '$$ROOT.author.name',
        participant_code: '$$ROOT.author.code.id',
        user_id: '$$ROOT.author._id',
        test: '$$ROOT.test',
        name: '$$ROOT.originTest.name',
        slug: '$$ROOT.originTest.slug',
        uploadType: '$$ROOT.uploadType',
        fileSize: { $size: '$$ROOT.rawdata' },
      },
    },
    { $sort: { created: 1 } },
  ]);
};

// get results of particular user for the testing page
resultSchema.statics.getResultsForUserTesting = function (feature) {
  return this.aggregate([
    // { $match: { 'uploadType' : 'full'} },
    { $match: { project: mongoose.Types.ObjectId(feature.project) } },
    { $match: { author: mongoose.Types.ObjectId(feature.author) } },
    {
      $project: {
        taskslug: '$$ROOT.taskslug',
        test: '$$ROOT.test',
        uploadType: '$$ROOT.uploadType',
      },
    },
  ]);
};

// get my results from different projects
resultSchema.statics.getMyResults = function (feature) {
  return this.aggregate([
    { $match: { author: mongoose.Types.ObjectId(feature.author) } },
    { $match: { rawdata: { $exists: true } } },
    {
      $lookup: {
        from: 'tests',
        localField: 'test',
        foreignField: '_id',
        as: 'originTest',
      },
    },
    {
      $lookup: {
        from: 'projects',
        localField: 'project',
        foreignField: '_id',
        as: 'originProject',
      },
    },
    {
      $project: {
        created: '$$ROOT.created',
        project_name: '$$ROOT.originProject.name',
        participant_id: '$$ROOT.author.openLabId',
        test: '$$ROOT.test',
        name: '$$ROOT.originTest.name',
        slug: '$$ROOT.originTest.slug',
        uploadType: '$$ROOT.uploadType',
        fileSize: { $size: '$$ROOT.rawdata' },
        deleteRequest: '$$ROOT.deleteRequest',
        dataRequest: '$$ROOT.dataRequest',
        openDataForParticipant: '$$ROOT.openDataForParticipant',
      },
    },
    { $sort: { created: 1 } },
  ]);
};

// get my results from different projects
resultSchema.statics.getParticipantResults = function (feature) {
  return this.aggregate([
    { $match: { author: mongoose.Types.ObjectId(feature.author) } },
    { $match: { uploadType: 'full' } },
    {
      $lookup: {
        from: 'tests',
        localField: 'test',
        foreignField: '_id',
        as: 'originTest',
      },
    },
    {
      $lookup: {
        from: 'projects',
        localField: 'project',
        foreignField: '_id',
        as: 'originProject',
      },
    },
    {
      $project: {
        created: '$$ROOT.created',
        project_name: '$$ROOT.originProject.name',
        participant_id: '$$ROOT.author.openLabId',
        test: '$$ROOT.test',
        name: '$$ROOT.originTest.name',
        slug: '$$ROOT.originTest.slug',
        uploadType: '$$ROOT.uploadType',
        fileSize: { $size: '$$ROOT.rawdata' },
        deleteRequest: '$$ROOT.deleteRequest',
        dataRequest: '$$ROOT.dataRequest',
        openDataForParticipant: '$$ROOT.openDataForParticipant',
      },
    },
    { $sort: { created: 1 } },
  ]);
};

// method to get results with the defined data
resultSchema.statics.getResults = function (feature) {
  return this.aggregate([
    { $match: { test: mongoose.Types.ObjectId(feature.test) } }, // filter only users
    { $match: { project: feature.project } }, // filter only users
    { $match: { rawdata: { $exists: true } } },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'author',
      },
    },
    {
      $lookup: {
        from: 'tests',
        localField: 'test',
        foreignField: '_id',
        as: 'originTest',
      },
    },
    { $match: { 'author.level': { $lt: 10 } } }, // filter only users
    {
      $project: {
        created: '$$ROOT.created',
        participant_id: '$$ROOT.author.openLabId',
        participant_name: '$$ROOT.author.name',
        participant_code: '$$ROOT.author.code.id',
        user_id: '$$ROOT.author._id',
        test: '$$ROOT.test',
        fullName: '$$ROOT.originTest.fullName',
        slug: '$$ROOT.originTest.slug',
        uploadType: '$$ROOT.uploadType',
        fileSize: { $size: '$$ROOT.rawdata' },
        aggregated: '$$ROOT.aggregated',
      },
    },
    { $sort: { created: 1 } },
  ]);
};

function autopopulate(next) {
  this.populate('author');
  next();
}

// define indexes for the faster search
resultSchema.index({
  project: 1,
  author: 1,
  test: 1,
  uploadType: 1,
  transfer: 1,
});

resultSchema.pre('find', autopopulate);
resultSchema.pre('findOne', autopopulate);
// resultSchema.pre('getResults', autopopulate);

module.exports = mongoose.model('Result', resultSchema);
