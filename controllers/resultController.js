const mongoose = require('mongoose');
const papaparse = require('papaparse');
const stream = require('stream');
const flatMap = require('flatmap');

const Result = mongoose.model('Result');
const User = mongoose.model('User');
const Test = mongoose.model('Test');
const Param = mongoose.model('Param');
const Project = mongoose.model('Project');
const Log = mongoose.model('Log');
const fetch = require('node-fetch');

// show the results of one user on a separate page
exports.showParticipantResults = async (req, res) => {
  const results = await Result.getParticipantResults({ author: req.user._id });
  res.render('showParticipantResults', { results });
};

// show the results of one user on a separate page
exports.showMyResults = async (req, res) => {
  const results = await Result.getMyResults({ author: req.user._id });
  res.render('showResults', { results });
};

// download metadata for a user as a csv file
exports.downloadMetadataUser = async (req, res) => {
  const project = await Project.findOne({ _id: req.user.project._id });
  confirmOwner(project, req.user);
  const results = await Result.find({
    author: req.params.id,
    rawdata: { $exists: true },
  });
  if (results && results.length > 0) {
    const name = req.params.identity;
    const data = results.map((e) => e.rawdata[0].meta);
    const csv_file = papaparse.unparse({ data });
    res.setHeader(
      'Content-disposition',
      `attachment; filename=meta_${name}.csv`
    );
    res.send(csv_file);
  } else {
    req.flash(
      'error',
      `There is no metadata results saved on Open Lab for this user`
    );
    res.redirect('back');
  }
};

// download results of a user as a csv file
exports.downloadResultsUser = async (req, res) => {
  const project = await Project.findOne({ _id: req.user.project._id });
  confirmOwner(project, req.user);
  const results = await Result.find(
    {
      author: req.params.id,
      project: req.user.project._id,
      rawdata: { $exists: true },
    },
    { rawdata: 1, author: 1 }
  );
  if (results && results.length > 0) {
    const authoreddata = results
      .map((u) => {
        u.rawdata.map((e) => e);
        if (u.rawdata[0].meta) {
          u.rawdata[0].meta = JSON.stringify(u.rawdata[0].meta);
        }
        if (
          u.author &&
          u.author.participantHistory &&
          u.author.participantHistory.length
        ) {
          const confirmationCode = u.author.participantHistory
            .filter(
              (project) => project.project_id == String(req.user.project._id)
            )
            .map((project) => project.individual_code)[0];
          if (confirmationCode) {
            u.rawdata[0].confirmationCode = confirmationCode;
          }
        }
        return u.rawdata;
      })
      .reduce((a, b) => a.concat(b), []);
    const keys = authoreddata
      .map((e) => Object.keys(e))
      .reduce((a, b) => Array.from(new Set(a.concat(b))));
    const name = req.params.identity;
    const csv_file = papaparse.unparse({
      fields: keys,
      data: authoreddata,
    });
    res.setHeader('Content-disposition', `attachment; filename=${name}.csv`);
    res.send(csv_file);
  } else {
    req.flash('error', `There is no results saved on Open Lab for this user`);
    res.redirect('back');
  }
};

const confirmOwner = (project, user) => {
  // check whether the user is a creator or a member of the project
  const isCreator = project.creator.equals(user._id);
  const isMember = project.members
    .map((id) => id.toString())
    .includes(user._id.toString());
  const isSuperAdmin = user.level > 100;
  const isParticipant = user.level <= 10;
  if (!(isCreator || isMember || isSuperAdmin) || isParticipant) {
    throw Error(
      'You must be a creator or a member of a project in order to do it!'
    );
  }
};

// download all projects data for an researcher as a csv file
exports.downloadprojectdata = async (req, res) => {
  // check whether the user has right to access the data from the project
  const type = req.params.type === 'full' ? 'full' : ['full', 'incremental'];
  const project = await Project.findOne({ _id: req.params.id });
  confirmOwner(project, req.user);
  let keys = [];
  const { name } = req.user.project;
  const croppedName = name.split(' ').join('-');
  res.setHeader(
    'Content-disposition',
    `attachment; filename=${croppedName.replace(
      /[^\x00-\x7F]/g,
      ''
    )}projectData.csv`
  );
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  const cursor = await Result.find(
    { project: req.user.project._id, uploadType: type },
    { rawdata: 1, author: 1 }
  )
    .cursor()
    .on('data', (obj) => {
      // return only the results of participants (level < 10)
      if (obj.author.level < 10 && obj.rawdata && obj.rawdata.length > 0) {
        if (obj.rawdata[0].meta) {
          obj.rawdata[0].meta = JSON.stringify(obj.rawdata[0].meta);
        }
        // record confirmation code if it is present in the dataset
        if (
          obj.author &&
          obj.author.participantHistory &&
          obj.author.participantHistory.length
        ) {
          const confirmationCode = obj.author.participantHistory
            .filter((project) => project.project_id == req.params.id)
            .map((project) => project.individual_code)[0];
          if (confirmationCode) {
            obj.rawdata[0].confirmationCode = confirmationCode;
          }
        }
        const preKeys = flatMap(obj.rawdata, function (e) {
          return Object.keys(e);
        });
        const tempkeys = Array.from(new Set(preKeys));
        const new_items = tempkeys.filter((x) => !keys.includes(x));
        let parsed;
        if (new_items.length > 0) {
          keys = keys.concat(new_items);
          parsed = `${papaparse.unparse({
            data: obj.rawdata,
            fields: keys,
          })}\r\n`;
        } else {
          const preparsed = `${papaparse.unparse({
            data: obj.rawdata,
            fields: keys,
          })}\r\n`;
          parsed = preparsed.replace(/(.*\r\n)/, '');
        }
        input.push(parsed);
      }
    })
    .on('end', function () {
      input.push(null);
    })
    .on('error', function (err) {
      console.log(err);
    });
  const processor = input.pipe(res);
};

// download all projects data for an researcher as a csv file
exports.downloadprojectmetadata = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id });
  confirmOwner(project, req.user);
  let first = true;
  const { name } = req.user.project;
  const croppedName = name.split(' ').join('-');
  res.setHeader(
    'Content-disposition',
    `attachment; filename=meta_${croppedName.replace(/[^\x00-\x7F]/g, '')}.csv`
  );
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  const cursor = await Result.find(
    { project: req.user.project._id },
    { rawdata: 1, author: 1 }
  )
    .cursor()
    .on('data', (obj) => {
      // return only the results of participants (level < 10)
      if (obj.author.level < 10 && obj.rawdata && obj.rawdata.length > 0) {
        const metadata = obj.rawdata[0].meta;
        const preparsed = `${papaparse.unparse([metadata])}\r\n`;
        let parsed;
        if (!first) {
          parsed = preparsed.replace(/(.*\r\n)/, '');
        } else {
          parsed = preparsed;
          first = false;
        }
        input.push(parsed);
      }
    })
    .on('end', function () {
      input.push(null);
    })
    .on('error', function (err) {
      console.log(err);
    });
  const processor = input.pipe(res);
};

// download summary statistics for all users of the project
exports.downloadSummaryData = async (req, res) => {
  const type = 'full';
  let keys = [];
  const { name } = req.user.project;
  res.setHeader('Content-disposition', `attachment; filename=${name}.csv`);
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  const cursor = await Result.find(
    { project: req.user.project._id, uploadType: type },
    { rawdata: 1, author: 1, taskslug: 1, uploadType: 1, transfer: 1 }
  )
    .cursor()
    .on('data', (obj) => {
      // console.log('obj', obj);
      // return only the results of participants (level < 10)
      if (obj.author && obj.author.level < 10) {
        const authoreddata = obj.rawdata
          .filter((e) => e.aggregated)
          .map((e) => {
            const l = {};
            l.timestamp = e.timestamp;
            l.participantId = (obj.author && obj.author.openLabId) || 'unknown';
            l.participantCode =
              (obj.author && obj.author.code && obj.author.code.id) ||
              'unknown';
            l.type = obj.uploadType;
            l.task = obj.taskslug;
            l.project = req.user.project.name;
            l.session = obj.transfer;
            Object.keys(e.aggregated).map((key) => {
              l[key] = e.aggregated[key];
            });
            return l;
          });
        const preKeys = flatMap(authoreddata, function (e) {
          return Object.keys(e);
        });
        const tempkeys = Array.from(new Set(preKeys));
        const new_items = tempkeys.filter((x) => !keys.includes(x));
        let parsed;
        if (new_items.length > 0) {
          keys = keys.concat(new_items);
          parsed = `${papaparse.unparse({
            data: authoreddata,
            fields: keys,
          })}\r\n`;
        } else {
          const preparsed = `${papaparse.unparse({
            data: authoreddata,
            fields: keys,
          })}\r\n`;
          parsed = preparsed.replace(/(.*\r\n)/, '');
        }
        input.push(parsed);
      }
    })
    .on('end', function () {
      input.push(null);
    })
    .on('error', function (err) {
      console.log(err);
    });
  const processor = input.pipe(res);
};

// download csv file for particular test and user
exports.downloadResultTestUser = async (req, res) => {
  const project = await Project.findOne({ _id: req.user.project._id });
  if (project) {
    confirmOwner(project, req.user);
  }
  const result = await Result.findOne(
    { _id: req.params.id },
    { rawdata: 1, author: 1 }
  );
  const ownsResult = result.author.id == req.user._id;
  if (!project) {
    if (!ownsResult) {
      throw Error('You must be an author of results in order to do it!');
    }
  }
  if (result.rawdata[0].meta) {
    result.rawdata[0].meta = JSON.stringify(result.rawdata[0].meta);
  }
  if (
    result.author &&
    result.author.participantHistory &&
    result.author.participantHistory.length
  ) {
    const confirmationCode = result.author.participantHistory
      .filter((project) => project.project_id == String(req.user.project._id))
      .map((project) => project.individual_code)[0];
    if (confirmationCode) {
      result.rawdata[0].confirmationCode = confirmationCode;
    }
  }
  const taskName = result.taskslug || 'result';
  const authorId = result.author.openLabId || 'undefined';
  const name = `${taskName}_${authorId}`;
  const keys = result.rawdata
    .map((e) => Object.keys(e))
    .reduce((a, b) => Array.from(new Set(a.concat(b))));
  const csv_file = papaparse.unparse({
    fields: keys,
    data: result.rawdata,
  });
  res.setHeader('Content-disposition', `attachment; filename=${name}.csv`);
  res.send(csv_file);
};

// download csv file for particular test in the project
exports.downloadTestResults = async (req, res) => {
  const type = req.params.type === 'full' ? 'full' : ['full', 'incremental'];
  const project = await Project.findOne({ _id: req.user.project._id });
  confirmOwner(project, req.user);
  let keys = [];
  const { name } = req.params;
  res.setHeader('Content-disposition', `attachment; filename=${name}.csv`);
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  const cursor = await Result.find(
    { project: req.user.project._id, test: req.params.test, uploadType: type },
    { rawdata: 1, author: 1 }
  )
    .cursor()
    .on('data', (obj) => {
      if (obj.rawdata[0].meta) {
        obj.rawdata[0].meta = JSON.stringify(obj.rawdata[0].meta);
      }
      // record confirmation code if it is present in the dataset
      if (
        obj.author &&
        obj.author.participantHistory &&
        obj.author.participantHistory.length
      ) {
        const confirmationCode = obj.author.participantHistory
          .filter(
            (project) => project.project_id == String(req.user.project._id)
          )
          .map((project) => project.individual_code)[0];
        if (confirmationCode) {
          obj.rawdata[0].confirmationCode = confirmationCode;
        }
      }
      const preKeys = flatMap(obj.rawdata, function (e) {
        return Object.keys(e);
      });
      const tempkeys = Array.from(new Set(preKeys));
      const new_items = tempkeys.filter((x) => !keys.includes(x));
      let parsed;
      if (new_items.length > 0) {
        keys = keys.concat(new_items);
        parsed = `${papaparse.unparse({
          data: obj.rawdata,
          fields: keys,
        })}\r\n`;
      } else {
        const preparsed = `${papaparse.unparse({
          data: obj.rawdata,
          fields: keys,
        })}\r\n`;
        parsed = preparsed.replace(/(.*\r\n)/, '');
      }
      input.push(parsed);
    })
    .on('end', function () {
      input.push(null);
    })
    .on('error', function (err) {
      console.log(err);
    });
  const processor = input.pipe(res);
};

// download csv file for all tests that matches the author id
exports.downloadMyResults = async (req, res) => {
  const type = req.params.type === 'full' ? 'full' : ['full', 'incremental'];
  let keys = [];
  res.setHeader(
    'Content-disposition',
    'attachment; filename=' + 'mydata' + '.csv'
  );
  const input = new stream.Readable({ objectMode: true });
  input._read = () => {};
  const cursor = await Result.find(
    { author: req.user._id, uploadType: type },
    { rawdata: 1, author: 1, project: 1 }
  )
    .cursor()
    .on('data', (obj) => {
      if (obj.rawdata[0].meta) {
        obj.rawdata[0].meta = JSON.stringify(obj.rawdata[0].meta);
      }
      // record confirmation code if it is present in the dataset
      if (
        obj.author &&
        obj.author.participantHistory &&
        obj.author.participantHistory.length
      ) {
        const confirmationCode = obj.author.participantHistory
          .filter((project) => project.project_id == String(obj.project._id))
          .map((project) => project.individual_code)[0];
        if (confirmationCode) {
          obj.rawdata[0].confirmationCode = confirmationCode;
        }
      }
      const preKeys = flatMap(obj.rawdata, function (e) {
        return Object.keys(e);
      });
      const tempkeys = Array.from(new Set(preKeys));
      const new_items = tempkeys.filter((x) => !keys.includes(x));
      let parsed;
      if (new_items.length > 0) {
        keys = keys.concat(new_items);
        parsed = `${papaparse.unparse({
          data: obj.rawdata,
          fields: keys,
        })}\r\n`;
      } else {
        const preparsed = `${papaparse.unparse({
          data: obj.rawdata,
          fields: keys,
        })}\r\n`;
        parsed = preparsed.replace(/(.*\r\n)/, '');
      }
      input.push(parsed);
    })
    .on('end', function () {
      input.push(null);
    })
    .on('error', function (err) {
      console.log(err);
    });
  const processor = input.pipe(res);
};

// delete all results of a user
exports.deleteMyResults = async (req, res) => {
  await Result.deleteMany({ author: req.user._id });
  req.flash('success', `${res.locals.layout.flash_data_deleted}`);
  res.redirect('back');
};

// delete data
exports.removeResultsData = async (req, res) => {
  const result = await Result.findOneAndRemove({ _id: req.params.filename });
  req.flash('success', `${res.locals.layout.flash_data_deleted}`);
  res.redirect('back');
};

exports.openDataForParticipant = async (req, res) => {
  const result = await Result.findOne({ _id: req.params.filename });
  if (result) {
    result.openDataForParticipant = !result.openDataForParticipant;
    await result.save();
    req.flash('success', `${res.locals.layout.flash_request_recorded}`);
    res.redirect('back');
  } else {
    req.flash('error', `${res.locals.layout.flash_not_authorized}`);
    res.redirect('back');
  }
};

// post delete request
exports.changeStatusOfDeleteRequest = async (req, res) => {
  // check whether the result is authored by a user
  const result = await Result.findOne({ _id: req.params.filename });
  if (
    result &&
    result.author &&
    result.author._id &&
    req.user._id.toString() == result.author._id.toString()
  ) {
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
  // check whether the result is authored by a user
  const result = await Result.findOne({ _id: req.params.filename });
  if (
    result &&
    result.author &&
    result.author._id &&
    req.user._id.toString() == result.author._id.toString()
  ) {
    result.dataRequest = !result.dataRequest;
    await result.save();
    req.flash('success', `${res.locals.layout.flash_request_recorded}`);
    res.redirect('back');
  } else {
    req.flash('error', `${res.locals.layout.flash_not_authorized}`);
    res.redirect('back');
  }
};

// save results during the task
exports.saveIncrementalResults = async (req, res) => {
  let anonymParticipantId;
  if (!req.user) {
    anonymParticipantId = req.body.url.split('/')[5];
  }

  const slug = req.body.url.split('/')[4];
  const test = await Test.findOne({ slug }).select({
    slug: 1,
    project: 1,
    author: 1,
  });

  const openLabId =
    (req.user && req.user.openLabId) || anonymParticipantId || 'undefined';
  const projectId =
    (req.user && req.user.participantInProject) ||
    (req.user && req.user.project._id) ||
    test.project ||
    'undefined';

  // create a log of completed task
  if (req.body.metadata.payload == 'full') {
    const log = new Log({
      type: 'TaskCompleted',
      author: (req.user && req.user._id) || test.author,
      project: projectId,
      test: test._id,
    });
    await log.save();
  }

  const project = await Project.findOne(
    { _id: projectId },
    {
      osf: 1,
      showCompletionCode: 1,
    }
  );

  let completionCodeOnline;
  if (project && project.showCompletionCode) {
    if (
      req.user &&
      req.user.participantHistory &&
      req.user.participantHistory.length
    ) {
      completionCodeOnline = req.user.participantHistory
        .filter((project) => project.project_id == String(projectId))
        .map((project) => project.individual_code)[0];
    }
  }

  if (req.body.data && req.body.data.length !== 0) {
    req.body.data.map((row) => {
      row.openLabId = openLabId;
      row.type = req.body.metadata.payload || 'undefined';
      row.task = slug || 'undefined';
      row.project = projectId;
      row.status =
        req.user && req.user.level > 10 ? 'researcher' : 'participant';
      row.code = (req.user && req.user.code && req.user.code.id) || openLabId;
      if (project && project.showCompletionCode) {
        row.confirmationCodeOngoing = completionCodeOnline;
      }
    });
  }

  if (
    req.body.metadata.payload == 'incremental' &&
    project &&
    project.osf &&
    project.osf.policy !== 'OSF'
  ) {
    const results = await Result.find(
      { transfer: req.body.metadata.id, uploadType: req.body.metadata.payload },
      { _id: 1, author: 0 }
    ).limit(1);
    if (results.length === 0) {
      const parameters = await Param.getParameters({
        slug,
        language:
          (req.user && req.user.language) ||
          req.body.url.split('/')[5] ||
          'english',
        author: projectId,
      });
      let params = 'no-change-of-params';
      if (parameters) {
        if (parameters[0]) {
          if (parameters[0].parameters) {
            params = parameters[0].parameters;
          }
        }
      }
      const result = new Result({
        transfer: req.body.metadata.id,
        author: (req.user && req.user._id) || test.author,
        openLabId,
        project: projectId,
        test: test._id,
        taskslug: slug,
        rawdata: req.body.data,
        uploadType: req.body.metadata.payload,
        parameters: params,
      });
      await result.save();
    } else {
      await Result.updateOne(
        {
          transfer: req.body.metadata.id,
          uploadType: req.body.metadata.payload,
        },
        { $push: { rawdata: { $each: req.body.data } } },
        {}
      );
    }
    res.send('saved');
  } else if (req.body.metadata.payload == 'full') {
    const parameters = await Param.getParameters({
      slug,
      language:
        (req.user && req.user.language) ||
        req.body.url.split('/')[5] ||
        'english',
      author: projectId,
    });
    let params = 'no-change-of-params';
    if (parameters) {
      if (parameters[0]) {
        if (parameters[0].parameters) {
          params = parameters[0].parameters;
        }
      }
    }

    let aggregated;
    if (req.body.data && req.body.data.length !== 0) {
      aggregated = req.body.data
        .filter((row) => typeof row.aggregated !== 'undefined')
        .map((e) => e.aggregated);
    }

    const fullResult = new Result({
      transfer: req.body.metadata.id,
      author: (req.user && req.user._id) || test.author,
      openLabId,
      project: projectId,
      test: test._id,
      taskslug: slug,
      rawdata: req.body.data,
      uploadType: req.body.metadata.payload,
      parameters: params,
      aggregated,
    });

    if (project && project.osf && project.osf.policy !== 'OSF') {
      await fullResult.save();
    } else {
      const osfFullResult = new Result({
        transfer: req.body.metadata.id,
        author: (req.user && req.user._id) || test.author,
        openLabId,
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
    if (
      project &&
      project.osf &&
      project.osf.upload_link &&
      project.osf.upload_token &&
      project.osf.policy !== 'OL'
    ) {
      const link = `${project.osf.upload_link}?kind=file&name=${openLabId}-${req.body.metadata.id}.csv`;
      const keys = req.body.data
        .map((e) => Object.keys(e))
        .reduce((a, b) => Array.from(new Set(a.concat(b))));
      const data = papaparse.unparse({
        fields: keys,
        data: req.body.data,
      });
      fetch(link, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${project.osf.upload_token}`,
        },
        body: data,
      })
        .then((response) => response.json())
        .then((JSON) => {})
        .catch((err) => {
          console.log(err);
        });
    }

    res.send('Data were saved');
  } else {
    res.send('Nothing was saved');
  }
};

// show the results for each test
exports.showDataByTests = async (req, res) => {
  let test;
  let results;
  let projectTests;
  const project = await Project.findOne(
    { _id: req.user.project._id },
    {
      name: 1,
      tests: 1,
    }
  );
  if (project) {
    const unsortedProjectTests = await Test.find({
      _id: { $in: project.tests },
      author: { $exists: true },
    }).select({ slug: 1, name: 1, photo: 1 });
    // order projectTests
    projectTests = unsortedProjectTests.sort(
      (a, b) => project.tests.indexOf(a.id) - project.tests.indexOf(b.id)
    );
  }
  const { slug } = req.params;
  if (slug && project) {
    test = await Test.findOne({ slug }, { _id: 1, name: 1, slug: 1 });
    results = await Result.getResults({
      test: test._id,
      project: req.user.project._id,
    }); // returns an array
  }
  res.render('resultsByTests', { project, slug, test, results, projectTests });
};

// show results of a particular test and a user
exports.showResults = async (req, res) => {
  const test = await Test.findOne({ slug: req.params.slug });
  const user = await User.findOne({ _id: req.params.id });
  if (!test || !user) return next();
  // find already existing results if they are in the database (otherwise would be null)
  const results = await Result.find({ test: test._id, author: user._id }); // returns an array
  res.render('showResults', { test, user, results, title: test.name });
};
