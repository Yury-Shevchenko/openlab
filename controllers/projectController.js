const mongoose = require('mongoose');

const Test = mongoose.model('Test');
const User = mongoose.model('User');
const Result = mongoose.model('Result');
const Project = mongoose.model('Project');

// show the user's projects
exports.getUserProjects = async (req, res) => {
  const projects = await Project.find(
    { creator: req.user._id },
    {
      name: 1,
      description: 1,
      members: 1,
      tests: 1,
      currentlyActive: 1,
      creator: 1,
      slug: 1,
      isRunning: 1,
    }
  );

  const invitedprojects = await Project.find(
    { members: req.user._id },
    {
      name: 1,
      description: 1,
      members: 1,
      tests: 1,
      currentlyActive: 1,
      creator: 1,
    }
  );
  res.render('projects', { title: 'Your projects', projects, invitedprojects });
};

exports.activateProject = async (req, res) => {
  const activeProject = await Project.findOne({ _id: req.params.id });
  confirmOwnerOrMember(activeProject, req.user);
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: req.user._id,
    },
    { project: activeProject },
    {
      new: true,
      upsert: true,
    }
  ).exec();
  req.flash(
    'success',
    `${activeProject.name} ${res.locals.layout.flash_activate_project}`
  );
  res.redirect('back');
};

exports.createProject = async (req, res) => {
  if (req.body.name != '') {
    try {
      let membersData = [];
      if (req.body.members) {
        const users = await User.find({
          email: { $in: req.body.members },
          level: { $gt: 10 },
        });
        membersData = users.map((e) => e._id);
      }
      const project = await new Project({
        name: req.body.name,
        description: req.body.description,
        welcomeMessage: req.body.welcomeMessage,
        completionMessage: req.body.completionMessage,
        creator: req.user._id,
        members: membersData,
        currentlyActive: req.body.currentlyActive,
        allowMultipleParticipation: req.body.allowMultipleParticipation == 'on',
        showCompletionCode: req.body.showCompletionCode == 'on',
        useNotifications: req.body.useNotifications == 'on',
        redirectUrl: req.body.redirectUrl,
      }).save();
      if (typeof req.user.project._id === 'undefined') {
        const updatedUser = await User.findOneAndUpdate(
          {
            _id: req.user._id,
          },
          { project },
          {
            new: true,
            upsert: true,
          }
        ).exec();
      }
      req.flash(
        'success',
        `${res.locals.layout.flash_project_created} <strong>${req.body.name}</strong>.`
      );
      res.redirect(`/projects`);
    } catch (err) {
      req.flash('error', err.message);
      res.redirect('back');
    }
  } else {
    req.flash('error', `${res.locals.layout.flash_give_name}`);
    res.redirect('back');
  }
};

exports.updateProject = async (req, res) => {
  try {
    let membersData = [];
    if (req.body.members) {
      const users = await User.find({ email: { $in: req.body.members } });
      membersData = users
        .map((e) => {
          if (e.email && e.email != null && typeof e.email !== 'undefined') {
            return e._id;
          }
        })
        .filter((e) => typeof e !== 'undefined');
    }
    const project = await Project.findOne({ _id: req.params.id });
    confirmOwnerOrMember(project, req.user);
    project.name = req.body.name;
    project.description = req.body.description;
    project.welcomeMessage = req.body.welcomeMessage;
    project.completionMessage = req.body.completionMessage;
    (project.allowMultipleParticipation =
      req.body.allowMultipleParticipation == 'on'),
      (project.showCompletionCode = req.body.showCompletionCode == 'on');
    project.useNotifications = req.body.useNotifications == 'on';
    project.members = membersData;
    project.redirectUrl = req.body.redirectUrl;
    await project.save();
    req.flash('success', `${res.locals.layout.flash_project_updated}`);
    res.redirect('back');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('back');
  }
};

exports.editProject = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id });
  let membersEmails = [];
  if (project.members) {
    const users = await User.find({ _id: { $in: project.members } });
    membersEmails = users.map((e) => e.email);
  }
  confirmOwnerOrMember(project, req.user);
  res.render('editProject', {
    title: `Edit ${project.name}`,
    project,
    membersEmails,
  });
};

const confirmOwner = (project, user) => {
  if (!project.creator.equals(user._id) || user.level <= 10) {
    throw Error('You must own a project in order to do it!');
  }
};

const confirmOwnerOrMember = (project, user) => {
  // check whether the user is a creator or a member of the project
  const isCreator = project.creator.equals(user._id);
  const isMember = project.members
    .map((id) => id.toString())
    .includes(user._id.toString());
  const isAdmin = user.level > 100;
  const isParticipant = user.level <= 10;
  if (!(isCreator || isMember || isAdmin) || isParticipant) {
    throw Error(
      'You must be a creator or a member of a project in order to do it!'
    );
  }
};

exports.trydeleteProject = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id });
  confirmOwner(project, req.user);
  if (!project.creator.equals(req.user._id) || req.user.level <= 10) {
    req.flash('error', `${res.locals.layout.flash_project_no_rights}`);
    res.redirect('back');
  } else {
    const resultsCount = await Result.where({
      project: req.params.id,
    }).countDocuments();
    const participantsCount = await User.where({
      participantInProject: req.params.id,
    }).countDocuments();
    res.render('deleteProjectForm', {
      project,
      resultsCount,
      participantsCount,
    });
  }
};

exports.removeProject = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id });
  confirmOwner(project, req.user);
  const resultsCount = await Result.where({
    project: req.params.id,
  }).countDocuments();
  if (req.body.confirmation == project.name) {
    if (resultsCount > 0) {
      const deletedResultsPromise = Result.deleteMany({
        project: req.params.id,
      });
      const projectRemovePromise = project.remove();
      await Promise.all([deletedResultsPromise, projectRemovePromise]);
      req.flash('success', `${res.locals.layout.flash_project_deleted}`);
      res.redirect('/projects');
    } else {
      project.remove((projectErr, removedProject) => {
        req.flash('success', `${res.locals.layout.flash_project_deleted}`);
        res.redirect('/projects');
      });
    }
  } else {
    req.flash('error', `${res.locals.layout.flash_cannot_delete}`);
    res.redirect('back');
  }
};

exports.changeStatusProject = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id });
  if (req.user.level < 100) {
    confirmOwnerOrMember(project, req.user);
  }

  if (req.params.action == 'on' || req.params.action == 'off') {
    project.currentlyActive = !project.currentlyActive;
    await project.save();
    req.flash(
      'success',
      `${
        req.params.action == 'on'
          ? res.locals.layout.flash_program_open
          : res.locals.layout.flash_program_closed
      }`
    );
    res.redirect('back');
  }

  if (req.params.action == 'run' || req.params.action == 'archive') {
    project.isRunning = !project.isRunning;
    await project.save();
    req.flash(
      'success',
      `${
        req.params.action == 'run'
          ? res.locals.layout.flash_program_archive
          : res.locals.layout.flash_program_run
      }`
    );
    res.redirect('back');
  }
};

exports.listPublicProjects = async (req, res) => {
  const { study } = req.query;
  const page = req.params.page || 1;
  const limit = 100;
  const skip = page * limit - limit;
  const projectsPromise = Project.findAllPublic().skip(skip).limit(limit);
  const allProjectsPromise = Project.getCurrentProjects();
  const countPromise = Project.where({
    currentlyActive: true,
    creator: { $exists: true },
  }).countDocuments();
  const [projects, count, allProjects] = await Promise.all([
    projectsPromise,
    countPromise,
    allProjectsPromise,
  ]);
  const pages = Math.ceil(count / limit);
  if (!projects.length && skip) {
    req.flash(
      'info',
      `${res.locals.layout.flash_page_not_exist_1} ${page}, ${res.locals.layout.flash_page_not_exist_2} ${pages}`
    );
    res.redirect(`/studies/page/${pages}`);
    return;
  }
  res.render('studies', { projects, page, pages, count, study, allProjects });
};

exports.showProjectDescription = async (req, res) => {
  const project = await Project.findOne(
    {
      _id: req.params.study,
      currentlyActive: true,
    },
    {
      name: 1,
      description: 1,
      currentlyActive: 1,
      isRunning: 1,
      tests: 1,
      creator: 1,
      created: 1,
    }
  );
  let author;
  if (project) {
    author = await User.findOne(
      { _id: project.creator },
      {
        name: 1,
        institute: 1,
      }
    );
  }
  let tests;
  if (project) {
    tests = await Test.find({
      _id: { $in: project.tests },
      author: { $exists: true },
      open: true,
    }).select({ author: 1, slug: 1, name: 1, description: 1, photo: 1 });
  } else {
    res.redirect('back');
    return;
  }
  res.render('study', { project, tests, author });
};

exports.manageNotifications = async (req, res) => {
  const project = await Project.findOne(
    { _id: req.user.project._id },
    {
      name: 1,
      notifications: 1,
    }
  );
  res.render('notifications', { project });
};

exports.debugprojects = async (req, res) => {
  const projects = await Project.debugProjects();
  res.render('debugprojects', { projects });
};

exports.updateWithOSF = async (req, res) => {
  const project = await Project.findOne({ _id: req.user.project._id });
  project.set(req.body);
  await project.save();
  req.flash('success', `The OSF project is updated`);
  res.redirect('/osf');
};

exports.editTaskInformation = async (req, res) => {
  const project = await Project.findOne(
    { _id: req.params.id },
    { creator: 1, tasksInformation: 1 }
  );
  confirmOwner(project, req.user);
  if (req.body) {
    project.tasksInformation = {
      randomize: req.body.randomize == 'Yes',
      sample: parseInt(req.body.sample),
    };
    await project.save();
  }
  req.flash('success', `${res.locals.layout.flash_param_update}`);
  res.redirect('back');
};
