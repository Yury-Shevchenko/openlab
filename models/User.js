const mongoose = require('mongoose');
const bcrypt = require('bcrypt-nodejs');
const Schema = mongoose.Schema;
mongoose.Promise = global.Promise;
const md5 = require('md5');
const validator = require('validator');

const userSchema = new Schema({

    local            : {
        password     : String
    },
    code             : {
        id           : String,
        password     : String
    },
    facebook         : {
        id           : String,
        token        : String,
        name         : String,
        email        : String
    },
    github          : {
        id           : String,
        token        : String,
        name         : String,
        email        : String
    },
    google           : {
        id           : String,
        token        : String,
        name         : String,
        email        : String
    },
    name             : String,
    email            : String,
    openLabId        : String,
    created          : {
        type         : Date,
        default      : Date.now
    },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    level            : Number, //The normal user is 1, the admin is 11
    language         : {
        type         : String,
        default      : "english"
    },
    participantInProject: {
        type         : mongoose.Schema.ObjectId,
        ref          : 'Project'
    },
    project: {
      _id : {type : mongoose.Schema.ObjectId, ref : 'Project'},
      name : String
    },
    institute             : String,
    participantHistory    : [
        {
          project_id      : {type : mongoose.Schema.ObjectId, ref : 'Project'},
          project_name    : String,
          individual_code : String,
        }
    ]
}, { toJSON: { virtuals: true } });

//methods
// generating a hash
userSchema.methods.generateHash = function(password) {
    return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
};

// checking if password is valid
userSchema.methods.validPassword = function(password) {
    return bcrypt.compareSync(password, this.local.password);
};

// checking if code is valid
userSchema.methods.validCode = function(password) {
    return bcrypt.compareSync(password, this.code.password);
};

//get users of a particular project (for /data)
userSchema.statics.getUsersOfProject = function(project) {
  return this.aggregate([
    { $lookup:
      {
        from: 'results',
        let: { current_project: project, current_author: '$_id' },
        pipeline: [
          { $match:
            { $expr:
              { $and:
                [
                  { $eq: ['$project', '$$current_project'] },
                  { $eq: ['$author', '$$current_author' ]}
                ]
              }
            }
          },
          {$project: {project: 1, test: 1,
            deleteRequests: { $cond: ['$deleteRequest', 1, 0] },
          }},
        ],
        as: 'results'
      }
    },
    { $match: {
      $or: [
        { 'results.project' : { $eq: project } }, //filter only results of the current project
        { 'participantInProject' : { $eq: project } }//filter users
        ]
      }
    },
    { $project: {
        name: '$$ROOT.name',
        level: '$$ROOT.level',
        participant_id: '$$ROOT.openLabId',
        participant_code: '$$ROOT.code.id',
        created: '$$ROOT.created',
        language: '$$ROOT.language',
        participantInProject: '$$ROOT.participantInProject',
        confirmationCodes: '$$ROOT.participantHistory',
        numberTests: {$size:
          { $setUnion: '$results.test' }
        },
        numberDeleteRequests: { $sum: '$results.deleteRequests' },
      }
    },
    { $sort : {identity: 1}}, //from highest to lowest
  ]);
};

//pre-save validation to make sure that the email does not already exist
userSchema.pre('save', function(next){
  if (!this.isModified('email') || this.email === ''){
    next();//skip it
  };
  var self = this;
  mongoose.models["User"].findOne({email: self.email}, function(err, user){
    if(err){
      next(err);
    } else if(user){
      self.invalidate("email", "This email already exists");
      next(new Error('This email already exists'));
    } else {
      next();
    }
  });
});

//method to get users with the data about tests that they have created (can be used for administration)
userSchema.statics.getUsersTests = function() {
  return this.aggregate([
    { $lookup: {
      from: 'tests', localField: '_id', foreignField: 'author', as: 'tests'
      }
    },
    { $project: {
      name: '$$ROOT.name',
      level: '$$ROOT.level',
      tests: '$$ROOT.tests'
      }
    }
  ]);
};

//method to get users
userSchema.statics.getUsers = function() {
  return this.aggregate([
    //lookup users and populate them
    { $lookup: {
      from: 'results', localField: '_id', foreignField: 'author', as: 'results'
      }
    },
    { $match: { 'level' : { $lt: 10 }} },//filter only users
    { $project: {
        name: '$$ROOT.name',
        level: '$$ROOT.level',
        identity: '$$ROOT.identity',
        created: '$$ROOT.created',
        language: '$$ROOT.language',
        project: '$$ROOT.project',
        projectidentity: '$$ROOT.projectidentity',
        averageRating: {$avg: '$results.rating'},
        numberTests: {$size:
          { $setUnion: '$results.text' }
        }//calculate the size of the array which is the set union of all taken tests
      }
    },
    //sort it by new field
    { $sort : {identity: 1}} //from highest to lowest
  ]);
};

//the method for tp ranking list, return only general information about users
userSchema.statics.getTopUsers = function(project_id) {
  return this.aggregate([
    { $lookup: {
      from: 'results', localField: '_id', foreignField: 'author', as: 'results'
      }
    },
    { $match: { 'projectidentity' : { $eq: project_id }} },//filter only users
    { $match: { 'results.0' : { $exists: true }} },
    { $match: { 'level' : { $lt: 10 }} },//filter only users
    { $project: {
      //list variables that are needed
        name: '$$ROOT.name',
        level: '$$ROOT.level',
        averageRating: {$sum: '$results.rating'},//to sum all ratings from all tasks
        numberTests: {$size:
          { $setUnion: '$results.text' }
        }//calculate the size of the array which is the set union of all taken tests
      }
    },
    //sort it by new field
    { $sort : {averageRating: -1}}, //from highest to lowest
  ]);
};

//find projects which user has created
userSchema.virtual('projects', {
  ref: 'Project',//what model to link
  localField: '_id',//which field in the current model Test
  foreignField: 'creator',//should match field in the other model Result
  justOne: false
});

userSchema.virtual('invitedprojects', {
  ref: 'Project',//what model to link
  localField: '_id',//which field in the current model Test
  foreignField: 'members',//should match field in the other model Result
  justOne: false
});

function autopopulate(next){
  this.populate({path: 'projects', select: 'creator name'});
  this.populate({path: 'invitedprojects', select: 'members creator name'});
  next();
};

userSchema.pre('find', autopopulate);
userSchema.pre('findOne', autopopulate);

module.exports = mongoose.model('User', userSchema);
