const mongoose = require('mongoose');
const papaparse = require('papaparse');
const fs = require('fs');
const stream = require('stream');
const flatMap = require('flatmap');
const Result = mongoose.model('Result');
const User = mongoose.model('User');
const Test = mongoose.model('Test');
const Param = mongoose.model('Param');
const Project = mongoose.model('Project');
const fetch = require('node-fetch');

//show the results of one user on a separate page
exports.showParticipantResults = async (req, res) => {
  const results = await Result.getParticipantResults({ author: req.user._id });
  res.render('showParticipantResults', {results});
};

//show the results of one user on a separate page
exports.showMyResults = async (req, res) => {
  const results = await Result.getMyResults({ author: req.user._id });
  res.render('showResults', {results});
};

//download metadata for a user as a csv file
exports.downloadMetadataUser = async (req, res) => {
  const project = await Project.findOne({ _id: req.user.project._id });
  confirmOwner(project, req.user);
  const results = await Result.find({ author: req.params.id, rawdata: { $exists: true } })
  if(results && results.length > 0){
    const name = req.params.identity;
    const data = results.map(e => e.rawdata[0].meta);
    const csv_file = papaparse.unparse({data});
    res.setHeader('Content-disposition', 'attachment; filename=meta_' + name +'.csv');
    res.send(csv_file);
  } else {
    req.flash('error', `There is no metadata results saved on Open Lab for this user`);
    res.redirect('back');
  }
};

//download results of a user as a csv file
exports.downloadResultsUser = async (req, res) => {
  const project = await Project.findOne({ _id: req.user.project._id });
  confirmOwner(project, req.user);
  const results = await Result.find({
    author: req.params.id,
    project: req.user.project._id,
    rawdata: { $exists: true },
  })
  if(results && results.length > 0){
    const authoreddata = results.map(u=>{
      u.rawdata.map(e=>{
        return e;
      })
      return u.rawdata;
    }).reduce((a,b)=>a.concat(b),[]);
    const keys = authoreddata.map(e => Object.keys(e)).reduce( (a,b) => Array.from(new Set(a.concat(b))) );
    const name = req.params.identity;
    const csv_file = papaparse.unparse({
       fields: keys,
  	   data: authoreddata
     });
    res.setHeader('Content-disposition', 'attachment; filename=' + name +'.csv');
    res.send(csv_file);
  } else {
    req.flash('error', `There is no results saved on Open Lab for this user`);
    res.redirect('back');
  }
};

const confirmOwner = (project, user) => {
  // check whether the user is a creator or a member of the project
  const isCreator = project.creator.equals(user._id);
  const isMember = project.members.map(id => id.toString()).includes(user._id.toString());
  const isSuperAdmin = user.level > 100;
  const isParticipant = user.level <= 10;
  if(!(isCreator || isMember || isSuperAdmin) || isParticipant){
    throw Error('You must be a creator or a member of a project in order to do it!');
  }
};

//download all projects data for an researcher as a csv file
exports.downloadprojectdata = async (req, res) => {
  // check whether the user has right to access the data from the project
  const type = req.params.type === 'full' ? 'full' : ['full', 'incremental'];
  const project = await Project.findOne({ _id: req.params.id });
  confirmOwner(project, req.user);
  let keys = [];
  const name = req.user.project.name;
  const croppedName = name.split(' ').join('-');
  res.setHeader('Content-disposition', 'attachment; filename=' + croppedName.replace(/[^\x00-\x7F]/g, "") + 'projectData.csv');
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  var cursor = await Result
    .find({project: req.user.project._id, uploadType: type},{rawdata:1, author:1})
    .cursor()
    .on('data', obj => {
      //return only the results of participants (level < 10)
      if(obj.author.level < 10 && obj.rawdata && obj.rawdata.length > 0){
        const preKeys = flatMap(obj.rawdata, function(e){
          return(Object.keys(e));
        });
        const tempkeys = Array.from(new Set(preKeys));
        const new_items = tempkeys.filter(x => !keys.includes(x));
        let parsed;
        if (new_items.length > 0){
          keys = keys.concat(new_items);
          parsed = papaparse.unparse({data: obj.rawdata, fields: keys}) + '\r\n';
        } else {
          const preparsed = papaparse.unparse({data: obj.rawdata, fields: keys}) + '\r\n';
          parsed = preparsed.replace(/(.*\r\n)/,'');
        };
        input.push(parsed);
      }
    })
    .on('end', function() { input.push(null) })
    .on('error', function(err) { console.log(err) });
  const processor = input.pipe(res);
};

//download all projects data for an researcher as a csv file
exports.downloadprojectmetadata = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id });
  confirmOwner(project, req.user);
  let first = true;
  const name = req.user.project.name;
  const croppedName = name.split(' ').join('-');
  res.setHeader('Content-disposition', 'attachment; filename=meta_' + croppedName.replace(/[^\x00-\x7F]/g, "") +'.csv');
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  var cursor = await Result
    .find({project: req.user.project._id},{rawdata:1, author:1})
    .cursor()
    .on('data', obj => {
      //return only the results of participants (level < 10)
      if(obj.author.level < 10 && obj.rawdata && obj.rawdata.length > 0){
        const metadata = obj.rawdata[0].meta;
        const preparsed = papaparse.unparse([metadata]) + '\r\n';
        let parsed;
        if(!first){
          parsed = preparsed.replace(/(.*\r\n)/,'');
        } else {
          parsed = preparsed;
          first = false;
        };
        input.push(parsed);
      }
    })
    .on('end', function() { input.push(null) })
    .on('error', function(err) { console.log(err) });
  const processor = input.pipe(res);
};

//download summary statistics for all users of the project
exports.downloadSummaryData = async (req, res) => {
  let keys = [];
  const name = req.user.project.name;
  const croppedName = name.split(' ').join('-');
  res.setHeader('Content-disposition', 'attachment; filename=' + croppedName.replace(/[^\x00-\x7F]/g, "") +'.csv');
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  var cursor = await Result
    .find({project: req.user.project._id},{rawdata:1, author:1})
    .cursor()
    .on('data', obj => {
        if(obj.author.level < 10){
        const preKeys = flatMap(obj.rawdata, function(e){
          return(Object.keys(e));
        });
        const tempkeys = Array.from(new Set(preKeys));
        const new_items = tempkeys.filter(x => !keys.includes(x));
        let parsed;
        if (new_items.length > 0){
          keys = keys.concat(new_items);
          parsed = papaparse.unparse({data: obj.rawdata, fields: keys}) + '\r\n';
        } else {
          const preparsed = papaparse.unparse({data: obj.rawdata, fields: keys}) + '\r\n';
          parsed = preparsed.replace(/(.*\r\n)/,'');
        };
        input.push(parsed);
      }
    })
    .on('end', function() { input.push(null) })
    .on('error', function(err) { console.log(err) });
  const processor = input.pipe(res);
};

//download csv file for particular test and user
exports.downloadResultTestUser = async (req, res) => {
  const project = await Project.findOne({ _id: req.user.project._id });
  confirmOwner(project, req.user);
  const result = await Result.findOne({ _id: req.params.id });
  const taskName = result.taskslug || 'result';
  const authorId = result.author.openLabId || 'undefined';
  const name = taskName + '_' + authorId;
  const keys = result.rawdata.map(e => Object.keys(e)).reduce( (a,b) => Array.from(new Set(a.concat(b))) );
  const csv_file = papaparse.unparse({
     fields: keys,
	   data: result.rawdata
   });
  res.setHeader('Content-disposition', 'attachment; filename=' + name +'.csv');
  res.send(csv_file);
};

//download csv file for particular test in the project
exports.downloadTestResults = async (req, res) => {
  const type = req.params.type === 'full' ? 'full' : ['full', 'incremental'];
  const project = await Project.findOne({ _id: req.user.project._id });
  confirmOwner(project, req.user);
  let keys = [];
  const name =  req.params.name;
  res.setHeader('Content-disposition', 'attachment; filename=' + name +'.csv');
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  var cursor = await Result
    .find({project: req.user.project._id, test: req.params.test, uploadType: type},{rawdata:1})
    .cursor()
    .on('data', obj => {
      const preKeys = flatMap(obj.rawdata, function(e){
        return(Object.keys(e));
      });
      const tempkeys = Array.from(new Set(preKeys));
      const new_items = tempkeys.filter(x => !keys.includes(x));
      let parsed;
      if (new_items.length > 0){
        keys = keys.concat(new_items);
        parsed = papaparse.unparse({data: obj.rawdata, fields: keys}) + '\r\n';
      } else {
        const preparsed = papaparse.unparse({data: obj.rawdata, fields: keys}) + '\r\n';
        parsed = preparsed.replace(/(.*\r\n)/,'');
      };
      input.push(parsed);
    })
    .on('end', function() { input.push(null) })
    .on('error', function(err) { console.log(err) });
  const processor = input.pipe(res);
};

//download csv file for all tests that matches the author id
exports.downloadMyResults = async (req, res) => {
  const type = req.params.type === 'full' ? 'full' : ['full', 'incremental'];
  let keys = [];
  res.setHeader('Content-disposition', 'attachment; filename=' + 'mydata' +'.csv');
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  var cursor = await Result
    .find({ author: req.user._id, uploadType: type},{ rawdata:1 })
    .cursor()
    .on('data', obj => {
      const preKeys = flatMap(obj.rawdata, function(e){
        return(Object.keys(e));
      });
      const tempkeys = Array.from(new Set(preKeys));
      const new_items = tempkeys.filter(x => !keys.includes(x));
      let parsed;
      if (new_items.length > 0){
        keys = keys.concat(new_items);
        parsed = papaparse.unparse({data: obj.rawdata, fields: keys}) + '\r\n';
      } else {
        const preparsed = papaparse.unparse({data: obj.rawdata, fields: keys}) + '\r\n';
        parsed = preparsed.replace(/(.*\r\n)/,'');
      };
      input.push(parsed);
    })
    .on('end', function() { input.push(null) })
    .on('error', function(err) { console.log(err) });
  const processor = input.pipe(res);
};

// delete all results of a user
exports.deleteMyResults = async (req, res) => {
  await Result.deleteMany({ author: req.user._id });
  req.flash('success', `${res.locals.layout.flash_data_deleted}`);
  res.redirect('back');
};

//delete data
exports.removeResultsData = async (req, res) => {
  const result = await Result.findOneAndRemove({ _id: req.params.filename });
  req.flash('success', `${res.locals.layout.flash_data_deleted}`);
  res.redirect('back');
};

exports.openDataForParticipant = async (req, res) => {
  const result = await Result.findOne({ _id: req.params.filename });
  if (result){
    result.openDataForParticipant = !result.openDataForParticipant;
    await result.save();
    req.flash('success', `${res.locals.layout.flash_request_recorded}`);
    res.redirect('back');
  } else {
    req.flash('error', `${res.locals.layout.flash_not_authorized}`);
    res.redirect('back');
  }
};

//post delete request
exports.changeStatusOfDeleteRequest = async (req, res) => {
  //check whether the result is authored by a user
  const result = await Result.findOne({ _id: req.params.filename });
  if (result && result.author && result.author._id && req.user._id.toString() == result.author._id.toString() ){
    result.deleteRequest = !result.deleteRequest;
    await result.save();
    req.flash('success', `${res.locals.layout.flash_request_recorded}`);
    res.redirect('back');
  } else {
    req.flash('error', `${res.locals.layout.flash_not_authorized}`);
    res.redirect('back');
  }
};

exports.changeStatusOfDataRequest = async (req, res) => {
  //check whether the result is authored by a user
  const result = await Result.findOne({ _id: req.params.filename });
  if (result && result.author && result.author._id && req.user._id.toString() == result.author._id.toString() ){
    result.dataRequest = !result.dataRequest;
    await result.save();
    req.flash('success', `${res.locals.layout.flash_request_recorded}`);
    res.redirect('back');
  } else {
    req.flash('error', `${res.locals.layout.flash_not_authorized}`);
    res.redirect('back');
  }
};

//save results during the task
exports.saveIncrementalResults = async (req, res) => {

  let anonymParticipantId;
  if (!req.user){ anonymParticipantId = req.body.url.split('/')[5] };

  const slug = req.body.url.split('/')[4];
  const test = await Test
    .findOne({ slug })
    .select({slug:1, project:1, author:1});

  const openLabId = (req.user && req.user.openLabId) || anonymParticipantId || "undefined";
  const projectId = (req.user && req.user.participantInProject) || (req.user && req.user.project._id) || test.project || "undefined";

  const project = await Project.findOne({ _id: projectId },{
    name: 1, osf: 1,
  });

  if(req.body.data && req.body.data.length !== 0){
    req.body.data.map(row => {
      row["openLabId"] = openLabId;
      row["type"] =  req.body.metadata.payload || "undefined";
      row["task"]= slug || "undefined";
      row['project'] = projectId;
      row['status'] = (req.user && req.user.level > 10) ? 'researcher' : 'participant';
      row['code'] = (req.user && req.user.code && req.user.code.id) || openLabId;
    })
  };

  if (req.body.metadata.payload == 'incremental' && project && project.osf && project.osf.policy !== 'OSF'){
    let result = await Result.findOne({transfer: req.body.metadata.id, uploadType: req.body.metadata.payload});
    if(!result){
      const parameters = await Param.getParameters({
        slug: slug,
        language: (req.user && req.user.language) || req.body.url.split('/')[5] || "english",
        author: projectId 
      });
      let params = "no-change-of-params";
      if(parameters){
        if(parameters[0]){
          if (parameters[0].parameters){
          params = parameters[0].parameters;
          }
        }
      }
      const result = new Result({
        transfer: req.body.metadata.id,
        author: (req.user && req.user._id) || test.author,
        openLabId: openLabId,
        project: projectId,
        test: test._id,
        taskslug: slug,
        rawdata: req.body.data,
        uploadType: req.body.metadata.payload,
        parameters: params
      });
      await result.save();
    } else {
      const updatedResult = await Result.findOneAndUpdate({
        transfer: req.body.metadata.id,
        uploadType: req.body.metadata.payload
      }, { $push: {rawdata: {$each: req.body.data } }}, {
        new: true
      }).exec();
    };
    res.send('saved');

  } else if(req.body.metadata.payload == 'full'){

    const parameters = await Param.getParameters({
      slug: slug,
      language: (req.user && req.user.language) || req.body.url.split('/')[5] || "english",
      author: projectId 
    });
    let params = "no-change-of-params";
    if(parameters){
      if(parameters[0]){
        if (parameters[0].parameters){
        params = parameters[0].parameters;
        }
      }
    }

    let aggregated;
    if(req.body.data && req.body.data.length !== 0){
      aggregated = req.body.data
        .filter(row => {
          return (typeof(row.aggregated) !== 'undefined')
        })
        .map(e => e.aggregated)
    };

    const fullResult = new Result({
      transfer: req.body.metadata.id,
      author: (req.user && req.user._id) || test.author,
      openLabId: openLabId,
      project: projectId,
      test: test._id,
      taskslug: slug,
      rawdata: req.body.data,
      uploadType: req.body.metadata.payload,
      parameters: params,
      aggregated: aggregated
    });

    if(project && project.osf && project.osf.policy !== 'OSF'){
      await fullResult.save();
    } else {
      const osfFullResult = new Result({
        transfer: req.body.metadata.id,
        author: (req.user && req.user._id) || test.author,
        openLabId: openLabId,
        project: projectId,
        test: test._id,
        taskslug: slug,
        uploadType: req.body.metadata.payload,
        parameters: params,
        storage: 'OSF',
      });
      await osfFullResult.save();
    }

    // upload data to osf
    if(project && project.osf && project.osf.upload_link && project.osf.upload_token && project.osf.policy !== 'OL'){
      const link = project.osf.upload_link + '?kind=file&name=' + openLabId + '-' + req.body.metadata.id + '.csv';
      const keys = req.body.data.map(e => Object.keys(e)).reduce( (a,b) => Array.from(new Set(a.concat(b))) );
      const data = papaparse.unparse({
         fields: keys,
    	   data: req.body.data
       });
      fetch(link, {
        method:'PUT',
        headers: {
          'Authorization': `Bearer ${project.osf.upload_token}`,
        },
        body: data
      })
      .then(response => {
        return response.json();
      })
      .then(JSON => {
      })
      .catch(err => {
        console.log(err);
      })
    };
    res.send('Data were saved');
  } else {
    res.send('Nothing was saved');
  }
};

//show the results for each test
exports.showDataByTests = async (req, res) => {
  let test, results, projectTests;
  const project = await Project.findOne({_id: req.user.project._id},{
    name: 1, tests: 1,
  });
  if(project){
    const unsortedProjectTests = await Test
      .find({
        _id: { $in: project.tests},
        author: { $exists: true }
      })
      .select({slug:1, name:1, photo:1})
    //order projectTests
    projectTests = unsortedProjectTests.sort( (a, b) => {
      return project.tests.indexOf(a.id) - project.tests.indexOf(b.id);
    });
  };
  const slug = req.params.slug;
  if (slug && project){
    test = await Test.findOne({slug: slug},{_id:1, name:1, slug:1});
    results = await Result.getResults({ test: test._id, project: req.user.project._id });//returns an array
  }
  res.render('resultsByTests', {project, slug, test, results, projectTests});
};


//show results of a particular test and a user
exports.showResults = async (req, res) => {
  const test = await Test.findOne({ slug: req.params.slug });
  const user = await User.findOne({ _id: req.params.id });
  if(!test || !user) return next();
  //find already existing results if they are in the database (otherwise would be null)
  const results = await Result.find({ test: test._id, author: user._id});//returns an array
  res.render('showResults', {test, user, results, title: test.name});
};
