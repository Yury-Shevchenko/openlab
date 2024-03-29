const mongoose = require('mongoose');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const multer = require('multer');
const uniqid = require('uniqid');
const crypto = require('crypto');

const User = mongoose.model('User');
const Result = mongoose.model('Result');
const Test = mongoose.model('Test');
const Project = mongoose.model('Project');
const keys = require('../config/keys');
const stripe = require('stripe')(keys.stripeSecretKey);

const validator = require('validator');
const slug = require('slugs');
const { assembleFileDev } = require('../handlers/assembleDev/index');
const { assembleFile } = require('../handlers/assemble/index');
const mail = require('../handlers/mail');

exports.login = (req, res) => {
  res.render('login', { title: 'Login', message: req.flash('loginMessage') });
};

exports.loginResearcher = (req, res) => {
  res.render('loginResearcher', {
    title: 'Login',
    message: req.flash('loginMessage'),
  });
};

exports.sign = async (req, res) => {
  let projectId;
  if (req.params.project) {
    const project = await Project.findOne({ name: req.params.project });
    if (project) projectId = project._id;
  }
  res.render('sign', {
    title: 'Sign in',
    message: req.flash('signupMessage'),
    project: projectId,
    code: req.params.code,
  });
};

exports.code = async (req, res) => {
  let joined_project;
  let projects;
  let temporary_code;
  if (req.params.project) {
    // the specific project was requested
    joined_project = await Project.findOne({ name: req.params.project });
    // user is logged in
    if (req.user && req.user.level && req.user.level < 10) {
      // the project exists
      if (joined_project && joined_project._id) {
        User.findById(req.user._id, (err, user) => {
          user.participantInProject = joined_project._id;
          user.save((saveErr, updatedUser) => {
            if (saveErr) {
              console.log('Authorisation error', saveErr);
            }
            res.redirect('/testing');
          });
        });
      } else {
        // no project found
        req.flash(
          'error',
          `There is no project with the name ${req.params.project} found. Please choose the project from the list.`
        );
        res.redirect('/studies');
      }
    } else {
      // user is not logged in
      if (joined_project && joined_project._id) {
        // project exists
        if (req.query.generate == 'true') {
          if (req.params.code) {
            temporary_code = `${uniqid()}-${req.params.code}`;
          } else {
            temporary_code = uniqid();
          }
        }
        res.render('code', {
          title: 'Enter with code',
          message: req.flash('codeMessage'),
          projects,
          joined_project,
          code: temporary_code || req.params.code,
        });
      } else {
        // no project found
        req.flash(
          'error',
          `There is no project with the name ${req.params.project} found. Please choose the project from the list.`
        );
        res.redirect('/code');
      }
    }
  } else {
    // the project was not specified
    if (req.user) {
      // user is logged in
      res.redirect('/studies');
    } else {
      // user is not logged in
      projects = await Project.getCurrentProjects();
      res.render('code', {
        title: 'Enter with code',
        message: req.flash('codeMessage'),
        projects,
        joined_project,
        code: temporary_code || req.params.code,
      });
    }
  }
};

exports.register = (req, res) => {
  res.render('register', { title: 'Register' });
};

exports.account = async (req, res) => {
  const projects = await Project.getCurrentProjects();
  res.render('account', { title: 'Edit Your Account', projects });
};

const multerOptions = {
  storage: multer.memoryStorage(),
  fileFilter(req, file, next) {
    const isOk = file.mimetype.startsWith('application/json');
    if (isOk) {
      next(null, true);
    } else {
      next({ message: 'That filetype is not allowed ' }, false);
    }
  },
};

exports.uploadfromlabjs = multer(multerOptions).fields([{ name: 'script' }]);

exports.labjs = async (req, res) => {
  if (req.files.script) {
    let newSlug = slug(req.body.name);
    if (newSlug === 'unnamed-study') {
      const randomUnnamedSlug = `study-${uniqid()}`;
      req.body.slug = randomUnnamedSlug;
      req.body.contentSlug = randomUnnamedSlug;
    } else {
      const slugRegEx = new RegExp(`^(${newSlug})((-[0-9]*$)?)$`, 'i'); // regular expression
      const testsWithSlug = await Test.find({
        slug: slugRegEx,
        _id: { $ne: req.params.id },
      });
      if (testsWithSlug.length) {
        newSlug = `${newSlug}-${testsWithSlug.length + 1}`;
      }
      req.body.slug = newSlug;
      const contentSlug = `${newSlug}-${uniqid()}`;
      req.body.contentSlug = contentSlug;
    }

    if (req.user) {
      req.body.author = req.user._id;
      req.body.project = req.user.project._id;
    }
    const prod =
      req.headers.referer == 'https://labjs-beta.netlify.com/' ||
      req.headers.referer == 'https://labjs-beta.netlify.app/' ||
      req.headers.referer == 'http://localhost:3000/'
        ? 'beta'
        : 'alpha'; // check from where the upload comes
    const json_string = req.files.script[0].buffer.toString();
    const json = JSON.parse(json_string);
    const { version } = json;
    let script;
    if (parseInt(version.join('')) > 2011) {
      script = await assembleFileDev(json, req.body.contentSlug);
    } else {
      script = await assembleFile(json, req.body.contentSlug);
    }
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
    req.body.production = prod;
    req.body.labjsVersion =
      typeof json.version === 'string' ? json.version : json.version.join(',');
    req.body.created = new Date().toISOString();
    req.body.scriptUpdated = new Date().toISOString();
    req.body.plugins = script.plugins;
    req.body.open = false;
    req.body.token = crypto.randomBytes(20).toString('hex');
    req.body.tokenExpires = Date.now() + 3600000; // 1 hour to upload the test
    const test = await new Test(req.body).save();
    req.flash(
      'success',
      `${res.locals.layout.flash_labjs_upload_success} <strong>${req.body.name}</strong>. ${res.locals.layout.flash_labjs_edit_message}`
    );
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'text/html');
    res.redirect(303, `/tests/labjs/${req.body.token}/edit`);
  } else {
    res.sendStatus(500);
  }
};

exports.editlabjsupload = async (req, res) => {
  const test = await Test.findOne({
    token: req.params.token,
    tokenExpires: { $gt: Date.now() },
  });
  if (!test) {
    req.flash('error', `${res.locals.layout.flash_labjs_upload_invalid}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    return res.redirect('/login');
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'text/html');
  res.status(200);
  res.render('editlabjsupload', { test }, function (err, html) {
    res.send(html);
  });
};

exports.updateAccount = async (req, res) => {
  User.findById(req.user._id, (err, user) => {
    if (req.body.participantInProject == '') {
      req.body.participantInProject = user.participantInProject;
    }
    if (req.body.email) {
      req.body.email = validator.normalizeEmail(req.body.email);
    }
    user.set(req.body);
    user.save((saveErr, updatedUser) => {
      if (saveErr) {
        req.flash('error', `${res.locals.layout.flash_profile_error_update}`);
      } else {
        req.flash('success', `${res.locals.layout.flash_profile_updated}`);
      }
      res.redirect('back');
    });
  });
};

// for administrators
exports.getData = async (req, res) => {
  const activeProjectPromise = Project.findOne(
    { _id: req.user.project._id },
    {
      invitations: 1,
      showCompletionCode: 1,
    }
  );
  const page = parseInt(req.params.page) || 1;
  const limit = 50;
  const skip = page * limit - limit;
  const usersPromise = User.getUsersOfProject(req.user.project._id)
    .skip(skip)
    .limit(limit);
  const countPromise = User.countDocuments({
    $or: [
      { participantInProject: req.user.project._id },
      { participant_projects: req.user.project._id },
    ],
  });
  const [users, count, project] = await Promise.all([
    usersPromise,
    countPromise,
    activeProjectPromise,
  ]);
  const pages = Math.ceil(count / limit);
  if (!users.length && skip) {
    req.flash(
      'info',
      `${res.locals.layout.flash_page_not_exist_1} ${page}, ${res.locals.layout.flash_page_not_exist_2} ${pages}`
    );
    res.redirect(`/users/page/${pages}`);
    return;
  }
  res.render('data', { users, page, pages, count, skip, project });
};

exports.invitations = async (req, res) => {
  const project = await Project.findOne(
    { _id: req.user.project._id },
    {
      name: 1,
      invitations: 1,
    }
  );
  res.render('invitations', { project });
};

exports.getOneUserData = async (req, res) => {
  const results = await Result.getUserResults({
    author: req.params.id,
    project: req.user.project._id,
  });
  if (results && results.length > 0) {
    res.render('dataOneUser', { participant: req.params.participant, results });
  } else {
    res.redirect('/users');
  }
};

exports.getResearchers = async (req, res) => {
  const users = await User.getResearchers().sort({ created: 'asc' });
  res.render('researchers', { title: 'Researchers', users });
};

exports.removeUser = async (req, res) => {
  const results = await Result.find({ author: req.params.id });
  if (results.length === 0) {
    const user = await User.findOneAndRemove({ _id: req.params.id });
    req.flash('success', `${res.locals.layout.flash_user_deleted}`);
  } else {
    req.flash('error', `${res.locals.layout.flash_user_cannot_be_deleted}`);
  }
  res.redirect('back');
};

// users invitation
exports.inviteParticipants = async (req, res) => {
  let emails = [];
  if (req.body.invitationsList) {
    const emailsRaw = req.body.invitationsList
      .replace(/ /g, '')
      .split(/\r\n|,|;/);
    if (emailsRaw) {
      emails = emails.concat(
        emailsRaw.filter((e) => e && e != null && e != '')
      );
    }
  }
  const project = await Project.findOne({ name: req.params.project });
  let sentEmails = [];
  if (project && project.invitations && project.invitations.length > 0) {
    sentEmails = project.invitations
      .filter((e) => typeof e !== 'undefined' && e != null && e.email != null)
      .map((e) => e.email);
  }
  const newInvitationEmails = emails.filter(
    (e) => e != null && e != '' && sentEmails.indexOf(e) == -1
  );

  let sentInvitations;
  const subject = res.locals.layout.flash_invitation;
  try {
    sentInvitations = await Promise.all(
      newInvitationEmails.map(async (email) => {
        if (email && email != null) {
          const token = uniqid();
          const participant = {
            email,
            project: project.name,
          };
          const singupURL = `https://${req.headers.host}/code/${req.params.project}/${token}`;
          await mail.send({
            participant,
            subject,
            singupURL,
            filename: `invitation-${req.user.language}`,
          });
          return { email, token };
        }
      })
    );
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('back');
    return;
  }
  if (sentInvitations && sentInvitations != null) {
    project.invitations = project.invitations.concat(sentInvitations);
  }
  await project.save();
  req.flash('success', `${res.locals.layout.flash_invited}`);
  res.redirect(`back`);
};

// payment functions
exports.subscribe = async (req, res) => {
  const currency =
    res.locals && res.locals.language && res.locals.language == 'en'
      ? 'usd'
      : 'eur';
  res.render('subscribe', {
    stripePublishableKey: keys.stripePublishableKey,
    plan: req.params.plan,
    period: req.params.period,
    currency,
  });
};

exports.changeLanguage = (req, res) => {
  const lang = req.params.language;
  if (req.user) {
    User.findById(req.user._id, (err, user) => {
      user.set({ language: lang });
      user.save((saveErr, updatedUser) => {
        if (saveErr) {
          req.flash('error', `${res.locals.layout.flash_profile_error_update}`);
        } else {
          req.flash('success', `${res.locals.layout.flash_profile_updated}`);
        }
        res.redirect('back');
      });
    });
  } else {
    req.session.visitor_language = lang;
    req.flash('success', `${res.locals.layout.flash_language_changed}`);
    res.redirect('back');
  }
};

exports.sendTestRequest = async (req, res) => {
  const { window } = new JSDOM('');
  const DOMPurify = createDOMPurify(window);
  const task = {
    taskDescription: DOMPurify.sanitize(req.body.taskDescription),
    example: DOMPurify.sanitize(req.body.example),
    time: DOMPurify.sanitize(req.body.time),
  };
  const researcher = {
    email: req.user.email || '',
    name: req.user.name || '',
    institute: req.user.institute || '',
    language: req.user.language,
    created: req.user.created,
    subscription: req.user.subscription || '',
    subscriptionExpires: req.user.subscriptionExpires || '',
    subscription_status: req.user.subscription_status || '',
    subscription_type: req.user.subscription_type || '',
  };
  await mail.request({
    researcher,
    task,
    filename: 'request',
  });
  req.flash('success', `${res.locals.layout.flash_test_request_sent}`);
  res.redirect('back');
};

exports.sendQuestion = async (req, res) => {
  const { window } = new JSDOM('');
  const DOMPurify = createDOMPurify(window);
  const question = DOMPurify.sanitize(req.body.question);
  const researcher = {
    email: req.user.email || '',
    name: req.user.name || '',
    institute: req.user.institute || '',
    language: req.user.language,
    created: req.user.created,
    subscription: req.user.subscription || '',
    subscriptionExpires: req.user.subscriptionExpires || '',
    subscription_status: req.user.subscription_status || '',
    subscription_type: req.user.subscription_type || '',
    level: req.user.level || '',
    openLabId: req.user.openLabId || '',
    code: (req.user.code && req.user.code.id) || '',
    contactEmail: DOMPurify.sanitize(req.body.email),
    participantHistory: req.user.participantHistory,
  };
  await mail.sendQuestion({
    researcher,
    question,
    filename: 'question',
  });
  req.flash('success', `${res.locals.layout.flash_question_sent}`);
  res.redirect('back');
};

exports.help = async (req, res) => {
  res.render('help');
};

exports.osfIntegration = async (req, res) => {
  const project = await Project.findOne(
    { _id: req.user.project._id },
    {
      name: 1,
      osf: 1,
      description: 1,
    }
  );
  res.render('osf', { project });
};

exports.invite = async (req, res) => {
  // queries
  let queryParams;
  if (req.query && Object.keys(req.query).length) {
    queryParams = req.query;
  }
  let joined_project;
  let temporary_code;
  if (req.params.project) {
    // the specific project was requested
    joined_project = await Project.findOne({ name: req.params.project });
    // user is logged in
    if (req.user && req.user.level & (req.user.level < 10)) {
      // the project exists
      if (joined_project && joined_project._id) {
        User.findById(req.user._id, (err, user) => {
          user.participantInProject = joined_project._id;
          user.save((saveErr, updatedUser) => {
            if (saveErr) {
              console.log('Authorisation error', saveErr);
            }
            if (queryParams) {
              const queryString = Object.keys(queryParams)
                .map((key) => `${key}=${queryParams[key]}`)
                .join('&');
              res.redirect(`/testing/start/?${queryString}`);
            } else {
              res.redirect('/testing/start');
            }
          });
        });
      } else {
        // no project found
        req.flash(
          'error',
          `There is no project with the name ${req.params.project} found. Please choose the project from the list.`
        );
        res.redirect('/studies');
      }
    } else {
      // user is not logged in
      if (joined_project && joined_project._id) {
        // project exists
        temporary_code = uniqid();
        res.render('invite', {
          joined_project,
          code: req.params.code || temporary_code,
          query: JSON.stringify(queryParams),
        });
      } else {
        // no project found
        req.flash(
          'error',
          `There is no project with the name ${req.params.project} found. Please choose the project from the list.`
        );
        res.redirect('/studies');
      }
    }
  } else {
    req.flash(
      'error',
      `There is no project found. Please choose the project from the list.`
    );
    res.redirect('/studies');
  }
};

exports.newsPage = async (req, res) => {
  res.render('news');
};
