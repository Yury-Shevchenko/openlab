const pickBy = require('lodash/pickBy');
const cloneDeep = require('lodash/cloneDeep');
const fromPairs = require('lodash/fromPairs');
const mapValues = require('lodash/mapValues');

const { embeddedFiles } = require('./files');
const { embedPlugins } = require('./plugins');
const { makeDataURI, readDataURI } = require('./dataURI');
const { makeScript } = require('./script');
const { makeHTML } = require('./html');

const cloudinary = require('cloudinary');

const fs = require('fs');
const getUri = require('get-uri');
const path = require('path');
// TODO: At some later point, header options
// should be derived from the study state
// to the greatest possible extent (i.e. via plugins).

const assembleFile = async (state, foldername,
  stateModifier=state => state,
  { additionalFiles={}, headerOptions={} }={}
) => {
  // Apply modification function to copy of current state
  let updatedState = stateModifier(cloneDeep(state))

  // Apply Open Lab redirect
  const redirects = {
    full: function(){
      window.location = '/testing';
    }
  };

  //add plugin to emit post event at the end of the study
  updatedState.components.root.plugins = [
    ...state.components.root.plugins,
    { type: 'lab.plugins.Transmit', url: '/save', callbacks: redirects}
  ]

  // get the parameters for Open Lab
  const main_sequence_number = Object.values(updatedState.components)
    .filter(el => el.id == 'root')
    .map(e => e.children[0])

  const params = Object.values(updatedState.components)
    .filter(el => el.id == main_sequence_number)
    .filter(e => e.parameters)
    .map(e => e.parameters)
    .map(r => r.rows)
    .reduce((flat, next) => flat.concat(next), [])
    .reduce((flat, next) => flat.concat(next), [])
    .filter(p => typeof(p) != "undefined" && p.name != '')


  // Filter files that are not embedded in components
  const filesInUse = embeddedFiles(updatedState.components)

  const files = pickBy(
    updatedState.files.files,
    (file, filename) =>
      file.source !== 'embedded' ||
      filesInUse.includes(filename)
  )

  for (let [key, value] of Object.entries(updatedState.components)){
    if (value.files && value.files.rows && value.files.rows.length > 0) {
      value.files.rows.map(o => {
        o.map(e => {
          const name = e.poolPath.split(`/`)[1];
          const poolPath = path.join('..', '..', 'embedded', foldername, name);
          e.poolPath = poolPath;
        })
      });
    }
  }

  const uploadFile = async (item) => {
    const name = item[0].split(`${item[1].source == "embedded" ? "embedded" : "static"}/`)[1];
    let string;
    if(item[1].content.startsWith('data:image/svg+xml')){
      string = item[1].content.replace('data:image/svg+xml', 'data:image/svg');
    } else {
      string = item[1].content;
    }
    const truncatedName = name.split('.')[0];
    const location = `${foldername}/${truncatedName}`;
    const upload_preset = "openlab";
    const options = {
      public_id: location,
      resource_type: 'auto'
    };
    await cloudinary.v2.uploader.unsigned_upload(
      string,
      upload_preset,
      options,
      function(error, result) {
        // for embedded files replace the address in poolPath
        if(result && item[1].source === "embedded"){
          for (let [key, value] of Object.entries(updatedState.components)){
            if (value.files && value.files.rows && value.files.rows.length > 0) {
              value.files.rows.map(o => {
                o.map(e => {
                  if (e.poolPath == item[0]){
                    e.poolPath = result.secure_url;
                  }
                })
              });
            }
          }
        }
        // for static files replace the address with the string replace method
        if(result && item[1].source === "embedded-global"){
          const stringifiedState = JSON.stringify(updatedState);
          const updatedStringifiedState = stringifiedState.replace(item[0], result.secure_url);
          const updatedWithImageState = JSON.parse(updatedStringifiedState);
          updatedState = updatedWithImageState;
          if(updatedState.files && updatedState.files.files && updatedState.files.files['index.html'] && updatedState.files.files['index.html'].content) {
            const stringifiedHeader = readDataURI(updatedState.files.files['index.html'].content);
            const updatedStringifiedHeader = stringifiedHeader.data.replace(item[0], result.secure_url);
            const updatedStringifiedHeaderParsed = makeDataURI(updatedStringifiedHeader);
            updatedState.files.files['index.html'].content = updatedStringifiedHeaderParsed;
          }
        }
      }
    );
  }
  function replaceAll(string, search, replace) {
    return string.split(search).join(replace);
  }

  const uploadFileLocally = async (item) => {
    const name = item[0].split(`${item[1].source == "embedded" ? "embedded" : "static"}/`)[1];
    const string = item[1].content;
    const dir = path.join('public', 'embedded', foldername);
    !fs.existsSync(dir) && fs.mkdirSync(dir);
    const address = path.join(dir, name);
    const writableAddress = path.join('..', '..', 'embedded', foldername, name);
    const writableStream = fs.createWriteStream(address);
    getUri(string, (err, res) => {
      if (err) throw err;
      res.pipe(writableStream);
    })
    if(item[1].source === "embedded-global"){
      const stringifiedState = JSON.stringify(updatedState);
      const updatedStringifiedState = replaceAll(stringifiedState, item[0], writableAddress);
      const updatedWithImageState = JSON.parse(updatedStringifiedState);
      updatedState = updatedWithImageState;
      if(updatedState.files && updatedState.files.files && updatedState.files.files['index.html'] && updatedState.files.files['index.html'].content) {
        const stringifiedHeader = readDataURI(updatedState.files.files['index.html'].content);
        const updatedStringifiedHeader = replaceAll(stringifiedHeader.data, item[0], writableAddress);
        const updatedStringifiedHeaderParsed = makeDataURI(updatedStringifiedHeader);
        updatedState.files.files['index.html'].content = updatedStringifiedHeaderParsed;
      }
    }
  }

  const arr = Object.entries(files).filter(i => {
    return (i && i[1] && (i[1].source == "embedded" || i[1].source == "embedded-global"))
  });

  await Promise.all(arr.map(item => {
    // return uploadFile(item)
    return uploadFileLocally(item)
  }))

  // Collect plugin data
  const { pluginFiles, pluginHeaders, pluginPaths } = embedPlugins(updatedState)

  // Extract the urls of plugins to inject them in the header in Open Lab
  const plugins = pluginHeaders
    .reduce((a, b) => a.concat(b), [])
    .filter(item => item.src)
    .map(item => {
      return({
        name: item.src,
        url: item.src
      })}
    )

  // Inject plugin headers
  const updatedHeaderOptions = {
    ...headerOptions,
    beforeHeader: [
      ...(headerOptions.beforeHeader || []),
      ...pluginHeaders,
    ]
  }

  // Inject plugin paths, where available
  updatedState.components = mapValues(updatedState.components, c => ({
    ...c,
    plugins: c.plugins
      ? c.plugins.map(p => ({
          ...p,
          path: Object.keys(pluginPaths).includes(p.type)
            ? pluginPaths[p.type]
            : p.path
        }) )
      : c.plugins
  }) )

  // Reassemble state object that now includes the generated script,
  // as well as any additional files required for the deployment target
  return {
    files: {
      // Static files stored in state
      ...files,
      // Files required by plugins
      ...pluginFiles,
      // Additional files injected by the export modifier
      ...additionalFiles,
      // Generated experiment files
      'script.js': {
        content: readDataURI(makeDataURI(
          makeScript(updatedState),
          'application/javascript',
        ))
      },
      'index.html': {
        content: makeDataURI(
          makeHTML(updatedState, updatedHeaderOptions, true),
          'text/html'
        )
      },
      header: makeDataURI(
        makeHTML(updatedState, updatedHeaderOptions, false),
        'text/html'
      )
    },
    bundledFiles: fromPairs(Object.entries(updatedState.files.bundledFiles).map(
      // Add source path to data, so that bundled files can be moved
      ([path, data]) => [path, { source: path, ...data }]
    )),
    params: params,
    plugins: plugins,
  }
}

exports.assembleFile = assembleFile;
