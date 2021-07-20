const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
const slug = require('slugs');

const testSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    required: 'Please enter a task name!',
  },
  slug: String,
  description: {
    type: String,
    trim: true
  },
  open: Boolean,
  tags: [String],
  position: Number,
  created: {
    type: Date,
    default: Date.now
  },
  scriptUpdated: {
    type: Date
  },
  token: String,
  tokenExpires: Date,
  timer: Number,
  photo: String,
  index: String,
  header: String,
  file: String,
  css: String,
  json: String,
  params: mongoose.Schema.Types.Mixed,
  production: String,
  labjsVersion: String,
  author: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  project: {
    type: mongoose.Schema.ObjectId,
    ref: 'Project'
  },
  version: String,
  plugins: [{
    name: String,
    url: String,
  }],
  contentSlug: String,
},{
  toJSON: {virtuals: true},//make virtuals visible
  toObject: {virtuals: true}
});

//method to get users with the data about tests that they have created (can be used for administration)
testSchema.statics.getTests = function(tests) {
  return this.aggregate([
    { $match: { _id: { $in: tests } } },
    { $project: {
      name: '$$ROOT.name',
      fullName: '$$ROOT.fullName',
      slug: '$$ROOT.slug',
      description: '$$ROOT.description',
      position: '$$ROOT.position',
      photo: '$$ROOT.photo',
    }},
  ]);
};

testSchema.statics.findAllPublic = function() {
  return this.aggregate([
    { $match: { open: true, author: { $exists: true } } },
    { $lookup: {
        from: 'users', localField: 'creator', foreignField: '_id', as: 'author'}
    },
    { $project: {
      name: '$$ROOT.name',
      insensitive: { '$toLower': '$$ROOT.name' },
      slug: '$$ROOT.slug',
      description: '$$ROOT.description',
      photo: '$$ROOT.photo',
    }},
    { $sort: { insensitive: 1 } }
  ]);
};

testSchema.statics.showAllTests = function(userID, tagQuery) {
  return this.aggregate([
    { $match: { $or: [
      { author: userID, open: false, tags: tagQuery },
      { author: { $exists: true }, open: true, tags: tagQuery},
    ]}},
    { $project: {
      name: '$$ROOT.name',
      fullName: '$$ROOT.fullName',
      slug: '$$ROOT.slug',
      open: '$$ROOT.open',
      description: '$$ROOT.description',
      author: '$$ROOT.author',
      photo: '$$ROOT.photo',
      production: '$$ROOT.production',
      json: { $cond: { if: '$$ROOT.json', then: true, else: false } },
    }},
    { $sort: { slug: 1 } }
  ]);
};

testSchema.statics.showMyTests = function(userID) {
  return this.aggregate([
    { $match: { author: userID }},
    { $project: {
      name: '$$ROOT.name',
      fullName: '$$ROOT.fullName',
      slug: '$$ROOT.slug',
      open: '$$ROOT.open',
      description: '$$ROOT.description',
      author: '$$ROOT.author',
      photo: '$$ROOT.photo',
      production: '$$ROOT.production',
      json: { $cond: { if: '$$ROOT.json', then: true, else: false } },
    }},
    { $sort: { slug: 1 } }
  ]);
};

testSchema.statics.showChosenTests = function(project_id, tests) {
  return this.aggregate([
    { $match: { _id: { $in: tests } } },
    { $lookup: {
        from: 'results', localField: '_id', foreignField: 'test', as: 'results'}
    },
    { $project: {
      name: '$$ROOT.name',
      fullName: '$$ROOT.fullName',
      slug: '$$ROOT.slug',
      description: '$$ROOT.description',
      position: '$$ROOT.position',
      timer: '$$ROOT.timer',
      author: '$$ROOT.author',
      photo: '$$ROOT.photo',
      numberResults: {$size:
        { $setUnion: {
          $filter:
          {
            input: "$results",
            as: "result",
            cond: { $eq: [ "$$result.project_id", project_id ] }
          }
        } }
      }
    }},
    { $sort: { position: 1 } }
  ]);
};

//define indexes for the faster search
testSchema.index({
  name: 'text',
  description: 'text',
  test: 1,
  slug: 'text',
});

// pre-save validation to make sure that the test slug is unique
testSchema.pre('save', async function(next){
  if (!this.isModified('name') || this.slug){
    next();//skip it
    return;//stop this function
  };
  this.slug = slug(this.name);
  //find other tests with the same slug
  const slugRegEx = new RegExp(`^(${this.slug})((-[0-9]*$)?)$`, 'i');//regular expression
  const testsWithSlug = await this.constructor.find({ slug: slugRegEx });
  if(testsWithSlug.length){
    this.slug = `${this.slug}-${testsWithSlug.length + 1}`;
  }
  next();
  // TODO make more resilient so slugs are unique
});

//define static function
testSchema.statics.getTagsList = function(id){
  return this.aggregate([
    { $match: {
      $or:[
        {
          open: true
        },
        {
          open: false,
          author: { $eq: id}
        }
      ]
    } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags' , count: {$sum: 1}} },
    { $sort: { count: -1 } }
  ]);
};

//find results where the tests _id property === results test property
testSchema.virtual('results', {
  ref: 'Result',//what model to link
  localField: '_id',//which field in the current model Test
  foreignField: 'test'//should match field in the other model Result
});

function autopopulate(next){
  this.populate('results');
  next();
};

module.exports = mongoose.model('Test', testSchema);
