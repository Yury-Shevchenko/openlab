const defaultSlugify = require('slugify');

const slugify = title =>
  defaultSlugify(title).toLowerCase()

exports.slugify = slugify;
