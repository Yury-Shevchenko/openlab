const mongoose = require('mongoose');
const promisify = require('es6-promisify');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const multer = require('multer');
const moment = require('moment');
const uniqid = require('uniqid');
const crypto = require('crypto');
const User = mongoose.model('User');
const Result = mongoose.model('Result');
const Test = mongoose.model('Test');
const Project = mongoose.model('Project');
const keys = require('../config/keys');
const stripe = require('stripe')(keys.stripeSecretKey);
const assemble = require('../handlers/assemble');
const mail = require('../handlers/mail');

exports.login = (req, res) => {
  res.render('login', {title: 'Login', message: req.flash('loginMessage')})
};

exports.loginResearcher = (req, res) => {
  res.render('loginResearcher', {title: 'Login', message: req.flash('loginMessage')})
};

exports.sign = async (req, res) => {
  let projectId;
  if(req.params.project){
    const project = await Project.findOne({ name: req.params.project });
    if (project) projectId = project._id
  }
  res.render('sign', {title: 'Sign in', message: req.flash('signupMessage'), project: projectId, code: req.params.code})
};

exports.code = async (req, res) => {
  let joined_project, projects;
  if(req.params.project){
    joined_project = await Project.findOne({ name: req.params.project });
  } else {
    projects = await Project.getCurrentProjects();
  };
  let temporary_code;
  if(req.query.generate == 'true'){
    if (req.params.code){
      temporary_code = uniqid() + '-' + req.params.code;
    } else {
      temporary_code = uniqid();
    }
  };
  res.render('code', {title: 'Enter with code', message: req.flash('codeMessage'), projects, joined_project, code: temporary_code || req.params.code});
};

exports.register = (req, res) => {
  res.render('register', {title: 'Register'});
};

exports.account = async (req, res) => {
  const projects = await Project.getCurrentProjects();
  res.render('account', {title: 'Edit Your Account', projects: projects});
};

const multerOptions = {
  storage: multer.memoryStorage(),
  fileFilter(req, file, next) {
    const isOk = file.mimetype.startsWith('application/json');
    if(isOk){
      next(null, true);
    } else {
      next( { message: 'That filetype is not allowed '}, false);
    }
  }
};

exports.uploadfromlabjs = multer(multerOptions).fields([
  {name: 'script'}
]);

exports.labjs = async (req, res) => {
  if(req.files.script){
      if(req.user){
        req.body.author = req.user._id;
      };
      const json_string = req.files.script[0].buffer.toString();
      const json = JSON.parse(json_string);
      const script = assemble.convertJSON(json);
      req.body.file = script.files.script.content.data;
      req.body.css = script.files['style.css'].content;
      req.body.params = script.params;
      req.body.script = moment().format('MMMM Do YYYY, h:mm:ss a');
      req.body.json = json_string;
      req.body.open = false;
      req.body.token = crypto.randomBytes(20).toString('hex');
      req.body.tokenExpires = Date.now() + 3600000; //1 hour to upload the test
      const test = await (new Test(req.body)).save()
      req.flash('success', `${res.locals.layout.flash_labjs_upload_success} <strong>${req.body.name}</strong>. ${res.locals.layout.flash_labjs_edit_message}`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.redirect(`/tests/labjs/${req.body.token}/edit`);
  } else {
    res.sendStatus(500);
  }
};

exports.editlabjsupload = async (req, res) => {
  const test = await Test.findOne({
    token: req.params.token,
    tokenExpires: { $gt: Date.now() }
  });
  if(!test){
    req.flash('error', `${res.locals.layout.flash_labjs_upload_invalid}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    return res.redirect('/login');
  };
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.render('editlabjsupload', {test});
};

exports.updateAccount = async (req, res) => {
    User.findById(req.user._id, (err, user) => {
      if(req.body.participantInProject == '') {req.body.participantInProject = user.participantInProject};
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

//for administrators
exports.getData = async (req, res) => {
  const activeProjectPromise = Project.findOne({_id: req.user.project._id},{
    invitations: 1, showCompletionCode: 1,
  });
  const page = parseInt(req.params.page) || 1;
  const limit = 50;
  const skip = (page * limit) - limit;
  const usersPromise = User
    .getUsersOfProject(req.user.project._id)
    .sort( {created: 'asc'} )
    .skip(skip)
    .limit(limit);
  const countPromise = User.where({ participantInProject: req.user.project._id }).countDocuments();
  const [users, count, project] = await Promise.all([ usersPromise, countPromise, activeProjectPromise ]);
  const pages = Math.ceil(count / limit);
  if(!users.length && skip){
    req.flash('info', `${res.locals.layout.flash_page_not_exist_1} ${page}. ${res.locals.layout.flash_page_not_exist_2} ${pages}`);
    res.redirect(`/users/page/${pages}`);
    return;
  }
  res.render('data', {users, page, pages, count, skip, project});
};

exports.invitations = async (req, res) => {
  const project = await Project.findOne({_id: req.user.project._id},{
    name: 1, invitations: 1,
  });
  res.render('invitations', {project});
};

exports.getOneUserData = async (req, res) => {
  const results = await Result.getUserResults({ author:  req.params.id, project: req.user.project._id });
  res.render('dataOneUser', {participant: req.params.participant, results});
};

exports.removeUser = async (req, res) => {
  const results = await Result.find({ author: req.params.id })
  if (results.length === 0){
    const user = await User.findOneAndRemove({ _id: req.params.id});
    req.flash('success', `${res.locals.layout.flash_user_deleted}`);
  } else {
    req.flash('error', `${res.locals.layout.flash_user_cannot_be_deleted}`);
  }
  res.redirect('back');
};

//users invitation
exports.inviteParticipants = async (req, res) => {
  let emails = [];
  if(req.body.invitationsList){
    const emailsRaw = req.body.invitationsList.replace(/ /g, '').split(/\r\n|,|;/);
    if(emailsRaw){
      emails = emails.concat(emailsRaw.filter(e => e && e != null && e != ''));
    }
  };
  const project = await Project.findOne( { name: req.params.project });
  let sentEmails = [];
  if (project && project.invitations && project.invitations.length > 0){
    sentEmails = project.invitations.filter(e => typeof(e) != 'undefined' && e != null &&  e.email != null).map(e => e.email);
  }
  const newInvitationEmails = emails.filter(e => e !=null && e != '' && sentEmails.indexOf(e) == -1);
  let sentInvitations;
  const subject = res.locals.layout.flash_invitation;
  try {
    sentInvitations = await Promise.all(newInvitationEmails.map(async (email) => {
      if(email && email != null){
        const token = uniqid();
        const participant = {
          email: email,
          project: project.name
        };
        const singupURL = `https://${req.headers.host}/code/${req.params.project}/${token}`;
        await mail.send({
          participant,
          subject,
          singupURL,
          filename: 'invitation-' + req.user.language
        });
        return ({email: email, token: token})
      }
    }));
  } catch(err) {
    req.flash('error', err.message);
    res.redirect('back');
    return;
  };
  if(sentInvitations && sentInvitations != null){
    project.invitations = project.invitations.concat(sentInvitations);
  }
  await project.save();
  req.flash('success', `${res.locals.layout.flash_invited}`);
  res.redirect(`back`);
};

exports.changeLanguage = (req, res) => {
  const lang = req.params.language;
  if(req.user){
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
  const window = (new JSDOM('')).window;
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
  };
  await mail.request({
    researcher,
    task,
    filename: 'request'
  });
  req.flash('success', `${res.locals.layout.flash_test_request_sent}`);
  res.redirect('back');
}

exports.sendQuestion= async (req, res) => {
  const window = (new JSDOM('')).window;
  const DOMPurify = createDOMPurify(window);
  const question = DOMPurify.sanitize(req.body.question);
  const researcher = {
    email: req.user.email || '',
    name: req.user.name || '',
    institute: req.user.institute || '',
    language: req.user.language,
    created: req.user.created,
    level: req.user.level || '',
    openLabId: req.user.openLabId || '',
    code: (req.user.code && req.user.code.id) || '',
  };
  await mail.sendQuestion({
    researcher,
    question,
    filename: 'question'
  });
  req.flash('success', `${res.locals.layout.flash_question_sent}`);
  res.redirect('back');
}

exports.help = async(req, res) => {
  res.render('help');
}
