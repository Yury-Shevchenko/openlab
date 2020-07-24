const mongoose = require('mongoose');
const multer = require('multer');
const jimp = require('jimp');
const uuid = require('uuid');//make unique identifier
const uniqid = require('uniqid');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const Project = mongoose.model('Project');
const Test = mongoose.model('Test');
const User = mongoose.model('User');
const Result = mongoose.model('Result');
const Param = mongoose.model('Param');
const keys = require('../config/keys');
const slug = require('slugs');
const { assembleFile } = require('../handlers/assemble/index');

const multerOptions = {
  storage: multer.memoryStorage(),
  fileFilter(req, file, next) {
    const isOk = file.mimetype.startsWith('image/') || file.mimetype.startsWith('application/json') ;
    if(isOk){
      next(null, true);
    } else {
      next( { message: 'That filetype is not allowed '}, false);
    }
  }
};

exports.homePage = async (req, res) => {
  res.render('index', {title: 'Welcome'});
};

exports.aboutPage = async (req, res) => {
  res.render('about');
};

exports.researcherPage = async (req, res) => {
  res.render('researcher', {action: req.params.action});
};

exports.participantPage = async (req, res) => {
  res.render('participant', {action: req.params.action});
};

exports.forgot = async (req, res) => {
  res.render('login', {title: 'Welcome', forgot: true});
};

exports.docs = (req, res) => {
  res.render('docs', {page: req.params.page || 'intro'});
};

exports.adminPage = (req, res) => {
  res.render('admin', {title: 'Administrator'});
};

exports.addTest = (req, res) => {
  res.render('editTest');
};

exports.upload = multer(multerOptions).fields([
  {name: 'script'},
  {name: 'photo'}
]);

exports.resize = async (req, res, next) => {
  if (req.files.photo && typeof(req.body.lucky) == 'undefined') {
    const extension = req.files.photo[0].mimetype.split('/')[1];
    if(!req.body.photo){
      req.body.photo = `${uuid.v4()}.${extension}`;
    };
    const photo = await jimp.read(req.files.photo[0].buffer);
    await photo.resize(800, jimp.AUTO);
    await photo.write(`./public/uploads/${req.body.photo}`);
    next();
  } else {
    if(!req.body.photo && typeof(req.body.lucky) != 'undefined' && req.body.lucky == 'on'){
      const photo = await jimp.read('https://source.unsplash.com/random');//https://source.unsplash.com/featured/?moon
      if (photo){
        const extension = photo._originalMime.split('/')[1];
        req.body.photo = `${uuid.v4()}.${extension}`;
        await photo.resize(800, jimp.AUTO);
        await photo.write(`./public/uploads/${req.body.photo}`);
      }
    };
    next();
    return;
  }
};

exports.createTest = async (req, res, next) => {
  req.body.author = req.user._id; //when the test is created the current id is put in the author
  req.body.project = req.user.project._id;

  let newSlug = slug(req.body.name);
  const slugRegEx = new RegExp(`^(${newSlug})((-[0-9]*$)?)$`, 'i');//regular expression
  const testsWithSlug = await Test.find({ slug: slugRegEx, _id: { $ne: req.params.id } });
  if(testsWithSlug.length){
    newSlug = `${newSlug}-${testsWithSlug.length + 1}`;
  }
  req.body.slug = newSlug;
  const contentSlug = `${newSlug}-${uniqid()}`;
  req.body.contentSlug = contentSlug;

  if(req.files.script){
    const json_string = req.files.script[0].buffer.toString();
    const json = JSON.parse(json_string);
    const script = await assembleFile(json, contentSlug);
    if (req.files.script[0].buffer.length > 16000000) {
      req.body.json = null;
      req.flash('error', `${res.locals.layout.flash_json_too_big}`);
    } else {
      req.body.json = json_string;
    }
    req.body.index = script.files['index.html'].content;
    req.body.header = script.files.header;
    req.body.css = script.files['style.css'].content;
    req.body.file = script.files['script.js'].content.data;
    req.body.params = script.params;
    req.body.production = 'alpha'; // assume that users use the alpha version
    req.body.labjsVersion = typeof(json.version) === 'string' ? json.version : json.version.join(',');
    req.body.created = new Date().toISOString();
    req.body.scriptUpdated = new Date().toISOString();
    req.body.plugins = script.plugins;
  }
  const test = await (new Test(req.body)).save();
  req.body.slug = test.slug;
  req.body._id = test._id;
  next();
};

exports.updateTest = async (req, res, next) => {
  if(req.user && req.user.project && req.user.project.tests){
    const usertests = req.user.project.tests;
    const id = req.params.id.toString();
    if(usertests.indexOf(id) > -1){
      throw Error('You must remove test from your active program before editing it!');
    };
  }
  if(req.user){
    if(req.user.level && req.user.level > 100) {
    } else {
      req.body.author = req.user._id;
      req.body.project = req.user.project._id;
    }
  }
  req.body.token = undefined;
  req.body.tokenExpires = undefined;

  let newSlug = slug(req.body.name);
  if (newSlug != req.body.slug){
    const slugRegEx = new RegExp(`^(${newSlug})((-[0-9]*$)?)$`, 'i');//regular expression
    const testsWithSlug = await Test.find({ slug: slugRegEx, _id: { $ne: req.params.id } });
    if(testsWithSlug.length){
      newSlug = `${newSlug}-${testsWithSlug.length + 1}`;
    }
    req.body.slug = newSlug;
  };
  if(!req.body.contentSlug) {
    const contentSlug = `${newSlug}-${uniqid()}`;
    req.body.contentSlug = contentSlug;
  }

  if(req.files.script){
    const json_string = req.files.script[0].buffer.toString();
    const json = JSON.parse(json_string);
    const script = await assembleFile(json, req.body.contentSlug);
    if (req.files.script[0].buffer.length > 16000000) {
      req.body.json = null;
      req.flash('error', `${res.locals.layout.flash_json_too_big}`);
    } else {
      req.body.json = json_string;
    }
    req.body.index = script.files['index.html'].content;
    req.body.header = script.files.header;
    req.body.css = script.files['style.css'].content;
    req.body.file = script.files['script.js'].content.data;
    req.body.params = script.params;
    req.body.production = 'alpha'; // assume that users use the alpha version
    req.body.labjsVersion = typeof(json.version) === 'string' ? json.version : json.version.join(',');
    if(req.user.level < 100){
      req.body.scriptUpdated = new Date().toISOString();
    }
    req.body.plugins = script.plugins;
  };

  const test = await Test.findOneAndUpdate({ _id: req.params.id }, req.body, {
    new: true, //return the new user instead of the old one
    runValidators: true
  }).exec();
  req.body.slug = test.slug;
  req.body._id = test._id;
  next();
};

//transfer the user after adding the test
exports.transfer = (req, res) => {
  req.flash('success', `${res.locals.layout.flash_test_updated} <strong>${req.body.name}</strong>. <a target="_blank" href="/test/${req.body.slug}/${req.user._id}">${res.locals.layout.flash_try_test}</a> `);
  res.redirect(`/tests/${req.body._id}/edit`);
}

//show the tests created by the user
exports.getMyTests = async (req, res) => {
  const page = req.params.page || 1;
  const limit = 18;
  const skip = (page * limit) - limit;
  const testsPromise = Test
    .showMyTests(req.user._id)
    .skip(skip)
    .limit(limit)
    .sort( {position: 'asc'} );
  const countPromise = Test.where({author: req.user._id}).countDocuments();
  const [tests, count] = await Promise.all([ testsPromise, countPromise ]);
  const pages = Math.ceil(count / limit);
  if(!tests.length && skip){
    req.flash('info', `${res.locals.layout.flash_page_not_exist_1} ${page}. ${res.locals.layout.flash_page_not_exist_2} ${pages}`);
    res.redirect(`/tests/my/page/${pages}`);
    return;
  }
  res.render('tests', {title: 'My tests', tests, page, pages, count, type: 'my'});
};

//show all tests
exports.getAllTests = async (req, res) => {
  const page = req.params.page || 1;
  const limit = 36;
  const skip = (page * limit) - limit;
  const tag = req.params.tag;
  const tagQuery = tag || { $exists: true };
  const tagsPromise = Test.getTagsList(req.user._id); //use a custom function to get tags list
  const testsPromise = Test
    .showAllTests(req.user._id, tagQuery)
    .skip(skip)
    .limit(limit)
  const countPromise = Test.where({
    $or:[
      {
        tags: tagQuery,
        open: true,
        author: { $exists: true }
      },
      {
        tags: tagQuery,
        open: false,
        author: { $eq: req.user._id}
      }
    ]
    }).countDocuments();
  const [tests, count, tags] = await Promise.all([ testsPromise, countPromise, tagsPromise ]);
  const pages = Math.ceil(count / limit);
  if(!tests.length && skip){
    req.flash('info', `${res.locals.layout.flash_page_not_exist_1} ${page}. ${res.locals.layout.flash_page_not_exist_2} ${pages}`);
    res.redirect(`/tests/all/${tag ? tag + '/' : ''}page/${pages}`);
    return;
  }
  res.render('tests', {tests, page, pages, count, tag, tags, type: 'all'});
};

//edit the test
exports.editTest = async (req, res) => {
  const test = await Test.findOne({ _id: req.params.id });
  confirmOwner(test, req.user);
  res.render('editTest', {test: test});
};

//to confirm the owner
const confirmOwner = (test, user) => {
  if(!test.author.equals(user._id) || user.level <= 10){
    if(user.level < 100){
      throw Error('You must own a test in order to edit it!');
    }
  }
};

//download lab.js json file
exports.downloadJSON = async (req, res) => {
  const test = await Test.findOne({ _id: req.params.id });
  const file = JSON.parse(test.json);
  res.setHeader('Content-disposition', 'attachment; filename=' + test.slug +'.json');
  res.send(file);
};

exports.openJSONinLabJS = async (req, res) => {
  const test = await Test.findOne({ _id: req.params.id });
  const file = test.json;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-disposition', 'attachment; filename=' + test.name.replace(/[^\x00-\x7F]/g, "") +'.json');
  res.status(200).send(file);
};


exports.tryRemoveTest = async (req, res) => {
  const test = await Test.findOne({_id: req.params.id});
  if((!test.author.equals(req.user._id) && req.user.level < 100) || req.user.level < 10){
    req.flash('error', `You must own a test in order to delete it!`);
    res.redirect('back');
  } else {
    const resultsCount = await Result.where({ test: req.params.id }).countDocuments();
    const parametersCount = await Param.where({ test: req.params.id }).countDocuments();
    res.render('deleteForm', {test, resultsCount, parametersCount });
  }
};

//delete the test
exports.removeTest = async (req, res) => {
  const test = await Test.findOne({_id: req.params.id}, {json: 1, name: 1, photo: 1, slug: 1, contentSlug: 1});
  let fileNames = [];
  if(test.json){
    const json = JSON.parse(test.json);
    if(json && json.files && json.files.files) {
      const keys = Object.keys(json.files.files)
      const names = keys.map(name => name.split('/')[1]);
      fileNames = names.filter(name => typeof(name) !== 'undefined');
    }
  }
  if (req.user.level > 100 || req.body.confirmation == test.name){
    if(test.photo){
      const photo_address = `./public/uploads/${test.photo}`;
      fs.stat(photo_address, function (err, stats) {
        if (err) {
          return console.error(err);
        }
        fs.unlink(photo_address,function(err){
          if(err) return console.log(err);
        });
      });
    }
    if(fileNames.length && test.contentSlug){
      const images_path = `./public/embedded/${test.contentSlug}`;
      if (fs.existsSync(images_path)) {
        fs.readdirSync(images_path).forEach((file, index) => {
          const ownsFile = fileNames.includes(file);
          if(ownsFile){
            const curPath = path.join(images_path, file);
            if (fs.lstatSync(curPath).isDirectory()) {
              deleteFolderRecursive(curPath);
            } else {
              fs.unlinkSync(curPath);
            }
          }
        });
        const isEmpty = fs.readdirSync(images_path).length === 0;;
        if(isEmpty){
          fs.rmdirSync(images_path);
        }
      }
    }
    test.remove((testErr, removedTest) => {
      req.flash('success', `${res.locals.layout.flash_test_deleted}`);
      res.redirect('/tests/my');
    });
  } else {
    req.flash('error', `${res.locals.layout.flash_test_cannot_delete}`);
    res.redirect('back');
  }
};

//display constructor of tests (with all tags, tests in the database, and chosen tests)
exports.constructor = async (req, res) => {
  const project = await Project.findOne({_id: req.user.project._id},{
    name: 1, tests: 1, tasksInformation: 1,
  });
  const tag = req.params.tag;
  const tagQuery = tag === 'all' ? { $exists: true } : (tag || { $exists: true });
  const authorQuery = tag ? { $exists: true } : req.user._id;
  const tagsPromise = Test.getTagsList(req.user._id); //use a custom function to get tags list
  //get only own private tests and tests that are opened by other researchers
  let testsPromise, projectTests, projectTestsPromise;
  let tags, tests, unsortedProjectTests;
  if(project){
    projectTestsPromise = Test
      .find({
        _id: { $in: project.tests },
        author: { $exists: true }
      })
      .select({slug:1, name:1})
    testsPromise = Test
      .find({
        $or:[
          {
            tags: tagQuery,
            _id: { $nin: project.tests},
            open: true,
            author: authorQuery
          },
          {
            tags: tagQuery,
            _id: { $nin: project.tests},
            open: false,
            author: req.user._id
          }
        ]
      })
      .select({author:1, slug:1, name:1, description: 1});
    [tags, tests, unsortedProjectTests] = await Promise.all([ tagsPromise, testsPromise, projectTestsPromise ]);
    //order projectTests
    projectTests = unsortedProjectTests.sort( (a, b) => {
      return project.tests.indexOf(a.id) - project.tests.indexOf(b.id);
    });
  }
  res.render('construct', { title: 'Select tests', tag, tags, tests, projectTests, project });
};

//add or remove a test from the list of chosen tests
//TODO make more robust against deleting the test
exports.featureTest = async (req, res) => {
  const project = await Project.findOne({ _id: req.user.project._id});

  const addedTests = project.tests.map(obj => obj.toString());
  const operator = addedTests.includes(req.params.id)? '$pull' : '$addToSet';
  const test = await Test.findOne({_id: req.params.id},{
    _id: 1
  });

  if(operator === '$pull'){
    const user_pull = await Project
      .findOneAndUpdate({_id: req.user.project._id},
        { ['$pull'] : {
          tests: req.params.id
        } },
        { new : true }
    );
    res.send(user_pull);
  } else {
    const user_push = await Project
      .findOneAndUpdate({_id: req.user.project._id},
        { ['$addToSet'] : {
          tests: req.params.id
        } },
        { new : true }
    );
    res.send(user_push);
  };
};

//search test by keyword
exports.searchTests = async (req, res) => {
  const tests = await Test
  .find({
    open: true,
    $text: {
      $search: req.query.q
    }
  }, {
    score: { $meta: 'textScore' }
  })
  .sort({
    score: { $meta: 'textScore' }
  })
  .limit(5);
  res.json(tests);
};

//show the separate screen for a test
exports.getTestBySlug = async (req, res, next) => {
  const test = await Test.findOne({ slug: req.params.slug });
  if(!test) return next();
  let author = 'missing';
  author = await User.findOne({ _id: test.author });
  res.render('test', { test, author: author, title: test.name });
};

//get tests that are chosen by the researcher
exports.getProgramTests = async (req, res) => {
  const project = await Project.findOne({_id: req.user.project._id},{
    name: 1, tests: 1, parameters: 1,
  });
  if(project){
    const unsortedProjectTests = await Test
      .find({
        _id: { $in: project.tests},
        author: { $exists: true }
      })
      .select({slug:1, name:1, photo:1})
    //order projectTests
    const projectTests = unsortedProjectTests.sort( (a, b) => {
      return project.tests.indexOf(a.id) - project.tests.indexOf(b.id);
    });

    const slug = req.params.slug;
    let param_language = req.params.lang || req.user.language;
    let test = 'nope';
    let original = 'nope';
    let modified = 'nope';
    let allParams = 'nope';
    let savedParameter = 'nope';

    if (slug){
      test = await Test.findOne({slug: slug},{_id:1, name:1, slug:1, params:1, description:1, version:1, script: 1});
    };

    if (test == null){
      test = 'nope';
    } else {
      const selector = req.params.selector;
      if (selector === 'original') {
        if(test){
          original = test.params || 'empty';
        } else {
          original = 'empty';
        };
      }
      if (selector === 'modified') {
        const params = await Param.findOne({project: req.user.project._id, test: test._id, language: param_language});
        allParams = await Param.find({project: req.user.project._id},{slug:1, language:1, created: 1});
        if(params){
          modified = params.parameters || 'empty';
        } else {
          modified = 'empty';
        };
      };
      if(selector === 'upload'){
        if(req.query.savedParameter != ''){
          savedParameter = await Param.findOne({_id: req.query.savedParameter});
          allParams = await Param.find({project: req.user.project._id},{slug:1, language:1, created: 1});
          param_language = savedParameter.language;
        }
      }
    }
    res.render('program', {project, slug, test, original, modified, allParams, savedParameter, param_language, projectTests});
  } else {
    res.render('program');
  }
};

// show tests
exports.testing = async (req, res) => {
  if(!req.user) {
    res.redirect('/');
  } else {
    const study = req.query.study;
    const project = await Project.findOne({ _id: req.user.participantInProject || req.user.project._id },{
      name: 1,
      allowMultipleParticipation: 1,
      showCompletionCode: 1,
      welcomeMessage: 1,
      completionMessage: 1,
      useNotifications: 1,
      tests: 1,
      parameters: 1,
      tasksInformation: 1,
    });
    const projects = await Project.getCurrentProjects();
    let tests, results, confirmationCode, projectTests;

    if(project){
      // update user parameters if there are project parameters
      if(project.parameters && project.parameters.length > 0){
        let userParameters;
        if(req.user && req.user.parameters){
          userParameters = req.user.parameters.filter(p => p.project_id.toString() === project._id.toString()).map(p => p.studyParameters);
        }
        if(userParameters && userParameters.length > 0){
          // user already has assigned parameters
        } else {
          const userParams = project.parameters.map(
            parameter => {
              let selectedParamContent, sample;
              // check if the mode is "urn" then sample without replacement
              if(parameter.mode === 'urnBefore'){
                // get one value from parameter.sample (if there is no value create parameter.sample as a copy of parameter.content
                if(parameter.sample && parameter.sample.length > 0){
                  sample = parameter.sample;
                } else {
                  sample = parameter.template;
                }
                selectedParamContent = sample.splice([Math.floor(Math.random() * sample.length)], 1);
                // fill out the urn if it is empty
                if(sample && sample.length === 0){
                  sample = parameter.template;
                }
                return({
                  name: parameter.name,
                  mode: parameter.mode,
                  template: parameter.template,
                  sample: sample,
                  content: selectedParamContent[0],
                })
              } else {
                const contentArray = parameter.sample;
                if(contentArray){
                  // random function to assign one of the parameters randomly (with the same probability)
                  selectedParamContent = contentArray[Math.floor(Math.random() * contentArray.length)];
                  return({
                    name: parameter.name,
                    mode: parameter.mode,
                    template: parameter.template,
                    sample: parameter.sample,
                    content: selectedParamContent,
                  })
                } else {
                  return parameter;
                }

              }
            }
          )
          project.parameters = userParams;
          await project.save();
          await User.findOneAndUpdate({
            _id: req.user._id
          }, {
            $addToSet: {
              parameters:
                {
                  project_id: project._id,
                  studyParameters: userParams,
                }
              },
          }, {
            new: true
          }).exec();
        }
      }

      //  23.06.20: randomize and sample
      const randomizeProjectTests = (project.tasksInformation && project.tasksInformation.randomize) || false;
      const sampleProjectTests = (project.tasksInformation && project.tasksInformation.sample) || null;

      function shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      }

      let projectOriginalTests = project.tests;

      const unsortedProjectTests = await Test
        .find({
          _id: { $in: projectOriginalTests},
          author: { $exists: true }
        })
        .select({slug:1, name:1, photo: 1})

      if(randomizeProjectTests){
        projectTests = shuffle(unsortedProjectTests);
      } else {
        projectTests = unsortedProjectTests.sort( (a, b) => {
          return projectOriginalTests.indexOf(a.id) - projectOriginalTests.indexOf(b.id);
        });
      }

      if(sampleProjectTests && sampleProjectTests > 0){
        projectTests = projectTests.slice(0, sampleProjectTests);
      }

      results = await Result.getResultsForUserTesting({ author: req.user._id, project: project._id });
      const arrayTests = projectTests.map(function(test) {return test.slug;});
      const arrayResults = results.map(function(result) {return result.taskslug;});
      const remainingArray = arrayTests.filter(function(test) {return !arrayResults.includes(test)});

      if(remainingArray.length == 0 && req.user.level < 10){
        const recordedCode = req.user.participantHistory.filter(e => e.project_id.toString() == req.user.participantInProject.toString());
        if (recordedCode.length == 0){
          confirmationCode = uniqid();
          await User.findOneAndUpdate({
            _id: req.user._id
          }, {
            $addToSet: {
              participant_projects: project._id,
              participantHistory:
                {
                  project_id: project._id,
                  project_name: project.name,
                  individual_code: confirmationCode,
                }
              },
          }, {
            new: true
          }).exec();
        } else {
          confirmationCode = req.user.participantHistory.filter(e => e.project_id.toString() == req.user.participantInProject.toString())[0].individual_code;
        };

        // if all tests are done, then we can update project parameters
        // update parameters (only after the last task)
        if(project.parameters && project.parameters.length > 0){
          if(req.user && req.user.parameters){
            userParameters = req.user.parameters.filter(p => p.project_id.toString() === project._id.toString()).map(p => p.studyParameters);
          }
          if(userParameters && userParameters.length > 0){
            const userParams = project.parameters.map(
              parameter => {
                // check if the mode is "urn" then sample without replacement
                if(parameter.mode === 'urnAfter'){
                  // TODO: check what happens when two participants at the same time demand one condition
                  let sample;
                  if(parameter.sample && parameter.sample.length > 0){
                    sample = parameter.sample;
                  } else {
                    sample = parameter.template;
                  }
                  const userValue = userParameters[0].filter(p => p.name === parameter.name).map(p => p.content);
                  const index = sample.indexOf(userValue[0]);
                  if(index > -1){
                    sample.splice(index, 1)
                  }
                  if(sample.length === 0){
                    sample = parameter.template;
                  }
                  return({
                    name: parameter.name,
                    mode: parameter.mode,
                    template: parameter.template,
                    sample: sample,
                    content: parameter.content,
                  })
                } else {
                  return parameter;
                }
              }
            )
            project.parameters = userParams;
            await project.save();
          }
        }

      };
    };

    if(req.params.selector === 'start' && projectTests && projectTests.length){
      const arrayTests = projectTests.map(function(test) {return test.slug});
      const arrayResults = results.map(function(result) {return result.taskslug});
      const doneArray = arrayTests.filter(function(test) {return arrayResults.includes(test)});
      const remainingArray = arrayTests.filter(function(test) {return !arrayResults.includes(test)});
      const nextTask = remainingArray[0] || "allDone";
      if(nextTask === 'allDone'){
        res.render('testing', {project, projects, results, study, confirmationCode, projectTests});
      } else {
        let queryString;
        if(req.query && Object.keys(req.query).length){
          const params = req.query;
          queryString = Object.keys(params).map(key => key + '=' + params[key]).join('&');
          res.redirect(`/test/${nextTask}/${req.user.id}?${queryString}`);
        } else {
          res.redirect(`/test/${nextTask}/${req.user.id}`);
        }
      }
    } else {
      res.render('testing', {project, projects, results, study, confirmationCode, projectTests});
    }
  }
};

exports.generateId = (req, res, next) => {
  if(!req.params.id){
    const id = uniqid();
    res.redirect(`/test/${req.params.slug}/${id}`);
    return;
  }
  next();
}

//run the test for a particular user
exports.runTest = async (req, res) => {
  const test = await Test.findOne({ slug: req.params.slug });
  const feature = {
    slug: req.params.slug,
    language: req.query.language || (req.user && req.user.language) || 'english',
    project: (req.user && req.user.participantInProject) || (req.user && req.user.project._id ) || test.project
  };
  // get the parameters from the user/study
  let studyParameters = [];
  if(req.user && req.user.parameters && req.user.parameters.length > 0) {
    const userParamsForThisProject = req.user.parameters.filter(param => param.project_id.toString() === feature.project.toString());
    if(userParamsForThisProject && userParamsForThisProject.length > 0){
      studyParameters = userParamsForThisProject[0] && userParamsForThisProject[0].studyParameters;
    } else {
      // fallback to project parameters
      const project = feature.project;
      if(project){
        const myProject = await Project.findOne({ _id: project }, { parameters: 1 });
        if(myProject){
          studyParameters = myProject.parameters;
        }
      }
    }
  }

  const parameters = await Param.getParameters(feature);
  let params = '';
  if(parameters){
    if(parameters[0]){
      if (parameters[0].parameters){
      params = parameters[0].parameters;
      }
    }
  }
  if(typeof(test.file) == 'undefined'){
    req.flash('error', `${res.locals.layout.flash_no_experiment_file}`);
    res.redirect('back');
  } else {
    res.render('runTest', { title: test.name, test, params, studyParameters: studyParameters });
  }
};

exports.listPublicTests = async(req, res) => {
  const page = req.params.page || 1;
  const limit = 18;
  const skip = (page * limit) - limit;
  const testsPromise = Test
    .find({
      open: true,
      author: { $exists: true }
    },{
      name: 1, slug: 1, description: 1, author: 1, photo: 1, open: 1,
    })
    .skip(skip)
    .limit(limit);
  const countPromise = Test.where({open: true, author: { $exists: true }}).countDocuments();
  const [tests, count] = await Promise.all([ testsPromise, countPromise ]);
  const pages = Math.ceil(count / limit);
  if(!tests.length && skip){
    req.flash('info', `${res.locals.layout.flash_page_not_exist_1} ${page}. ${res.locals.layout.flash_page_not_exist_2} ${pages}`);
    res.redirect(`/listing/page/${pages}`);
    return;
  }
  res.render('listing', {tests, page, pages, count});
};

exports.showAllTasksForAdmin = async (req, res) => {
  const tests = await Test
    .find({ },{
      name: 1, slug: 1, description: 1, author: 1, photo: 1, open: 1, created: 1, scriptUpdated: 1, production: 1, labjsVersion: 1
    })
  res.render('alltestsforadmin', {tests});
};
