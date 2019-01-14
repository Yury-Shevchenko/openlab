const cloneDeep = require('lodash/cloneDeep');
const fromPairs = require('lodash/fromPairs');
const toString = require('lodash/toString');
const toNumber = require('lodash/toNumber');
const zip = require('lodash/zip');
const pickBy = require('lodash/pickBy');
const isEmpty = require('lodash/isEmpty');
const serialize = require('serialize-javascript')

exports.convertJSON = (state, stateModifier=state => state, additionalFiles={}) => {
  // Apply modification function to copy of current state
  const updatedState = stateModifier(cloneDeep(state));
  const redirects = {
    full: function(){
      window.location = '/testing';
    }
  };
  //add plugin to emit post event at the end of the study
  updatedState.components.root.plugins = [
    ...state.components.root.plugins,
    //{ type: 'lab.plugins.PostMessage' },
    { type: 'lab.plugins.Transmit', url: '/save', callbacks: redirects}
    //https://github.com/FelixHenninger/lab.js/blob/master/packages/library/src/plugins/transmit.js
  ]
  const params = Object.values(updatedState.components)
    .map(e => e.parameters)
    .map(r => r.rows)
    .reduce((flat, next) => flat.concat(next), [])
    .reduce((flat, next) => flat.concat(next), [])
    .filter(p => typeof(p) != "undefined" && p.name != '')

  // Reassemble state object that now includes the generated script,
  // as well as any additional files required for the deployment target
  return {
    files: {
      'script': {
        content: readDataURI(makeDataURI(
          makeScript(updatedState),
          'application/javascript',
        ))
      },
      ...updatedState.files.files,
      ...additionalFiles,
    },
    bundledFiles: fromPairs(Object.entries(updatedState.files.bundledFiles).map(
      // Add source path to data, so that bundled files can be moved
      ([path, data]) => [path, { source: path, ...data }]
    )),
    params: params
  }
}


// Generic grid processing
const processGrid = (grid, colnames=null, types=undefined) =>
  grid.rows
    // Filter rows without data
    .filter( r => !r.every( c => c.trim() === '' ) )
    // Convert types if requested
    .map( r => r.map( (c, i) => makeType(c, types ? types[i] : undefined) ) )
    // Use column names to create array of row objects.
    // If column names are passed as a parameter,
    // use those, otherwise rely on the grid object
    .map( r => fromPairs(zip(colnames || grid.columns, r)) )

const processMessageHandlers = (messageHandlers) =>
  fromPairs(
    messageHandlers.rows
      .map(r => r[0])
      .filter(h => h.message.trim() !== '' && h.code.trim() !== '')
      // TODO: Evaluate the safety implications
      // of the following de-facto-eval.
      // eslint-disable-next-line no-new-func
      .map(h => [h.message, new Function(h.code)])
  )

const processParameters = parameters =>
  fromPairs(
    parameters.rows
      .map(r => r[0])
      .filter(r => r.name.trim() !== '' && r.value.trim() !== '')
      .map(r => [r.name, makeType(r.value, r.type)])
  )

const createResponsePair = r =>
  // Process an object with the structure
  // { label: 'label', event: 'keypress', ...}
  // into an array with two parts: a label,
  // and an event definition, such as
  // ['keypress(r)', 'red']
  [
    `${ r.event }` +
      `${ r.filter ? `(${ r.filter.trim() })` : ''}` +
      `${ r.target ? ` ${ r.target.trim() }`  : ''}`,
    r.label.trim()
  ]

// Process individual fields
const processResponses = (responses) => {
  // Process responses as a grid, resulting in an array
  // of objects that contain the individual parts
  const grid = processGrid(responses, ['label', 'event', 'target', 'filter'])
  // Process each of these objects into an array
  // of [responseParams, label] pairs
  const pairs = grid.map(createResponsePair)
  // Finally, create an object of
  // { responseParams: label } mappings
  return fromPairs(pairs)
}

// Template parameters are also a grid,
// but column names and data types are defined
// as properties of an object.
const processTemplateParameters = grid =>
  processGrid(
    grid,
    grid.columns.map(c => c.name),
    grid.columns.map(c => c.type)
  )

// Process any single node in isolation
const processNode = node => {
  // Options to exclude from JSON output
  const filteredOptions = ['skipCondition']

  // TODO: This filters empty string values, which are
  // created by empty form fields in the builder. This is
  // hackish, and may not work indefinately -- it might
  // have to be solved on the input side, or by making
  // the library more resilient to malformed input.
  // Either way, this is probably not the final solution.
  const filterOptions = (value, key) =>
    value !== '' &&
    !(key.startsWith('_') || filteredOptions.includes(key))

  return Object.assign({}, pickBy(node, filterOptions), {
    messageHandlers: node.messageHandlers
      ? processMessageHandlers(node.messageHandlers)
      : node.messageHandlers,
    parameters: node.parameters
      ? processParameters(node.parameters)
      : {},
    responses: node.responses
      ? processResponses(node.responses)
      : {},
    skip: node.skip || node.skipCondition || undefined,
    templateParameters: node.templateParameters
      ? processTemplateParameters(node.templateParameters)
      : node.templateParameters,
  })
}

// Process a node and its children
const makeComponentTree = (data, root) => {
	const currentNode = processNode(data[root])

  if (currentNode) {
    const output = Object.assign({}, currentNode)

    // Convert children, if available
    if (currentNode.children) {
      switch (currentNode.type) {
        case 'lab.flow.Sequence':
          // A sequence can have several components as content
          output.content = currentNode.children
            .map(c => makeComponentTree(data, c))
          break
        case 'lab.flow.Loop':
          // A loop has a single template
          if (!isEmpty(currentNode.children)) {
            output.template = makeComponentTree(data, currentNode.children[0])
          }
          break
        case 'lab.canvas.Frame':
        case 'lab.html.Frame':
          // A loop has a single template
          if (!isEmpty(currentNode.children)) {
            output.content = makeComponentTree(data, currentNode.children[0])
          }
          break
        default:
          // TODO: This won't catch canvas-based
          // components, but it also doesn't need
          // to right now.
          break
      }

      // After parsing, children components are no longer needed
      delete output.children
    }

    // Delete unused fields
    delete output.id

    return output
  } else {
    return {}
  }
}

const makeStudyScript = studyTreeJSON =>
`// Define study
const study = lab.util.fromObject(${ studyTreeJSON })
// Add data storage support
study.options.datastore = new lab.data.Store()

//assign parameters from the database
//Object.assign(study.options.parameters, params || {})
Object.assign(study.options.content[0].options.parameters, params || {})

// Let's go!
study.run()`

const makeScript = (state) => {
  // Process study tree
  const componentTree = makeComponentTree(state.components, 'root')
  const studyTreeJSON = serialize(componentTree, { space: 2 })
  return makeStudyScript(studyTreeJSON)
}

const makeType = (value, type) => {
  if (type === undefined) {
    // Return value unchanged
    return value
  } else {
    // Convert types
    switch (type) {
      case 'string':
        // Trim strings to avoid problems
        // caused by invisible spaces
        return toString(value).trim()
      case 'number':
        return value.trim() === '' ? null : toNumber(value)
      case 'boolean':
        // Only 'true' and 'false' are
        // accepted as values.
        // eslint-disable-next-line default-case
        switch (value.trim()) {
          case 'true':
            return true
          case 'false':
            return false
        }
      // eslint-disable-next-line no-fallthrough
      default:
        return null
    }
  }
}

const makeDataURI = (data, mime='') =>
  // Make data url from string
  `data:${ mime },${ encodeURIComponent(data) }`

const readDataURI = uri => {
  // Split data URI into constituent parts
  const re = /^\s*data:([\w]+\/[\w]+)?(;base64)?,(.*)$/
  const [, mime, encoding, data] = re.exec(uri)

  // Is the content encoded as base64?
  const base64 = encoding === ';base64'

  return {
    data: base64 ? data : decodeURIComponent(data),
    mime, base64
  }
}

const blobFromDataURI = uri => {
  const { data, mime, base64 } = readDataURI(uri)

  if (base64) {
    // Convert base64 to binary
    const binary = window.atob(data)
    // Decode raw bytes
    const bytes = new Uint8Array(binary.length)
    for (var i = 0; i < binary.length; i++)        {
      bytes[i] = binary.charCodeAt(i)
    }
    // Return as blob
    return new Blob([bytes], { type: mime })
  } else {
    // Return blob from string data
    return new Blob([data], { type: mime })
  }
}

const updateDataURI = (uri, updater, ...args) => {
  const { data, mime } = readDataURI(uri)
  const newData = updater(data, ...args)
  return makeDataURI(newData, mime)
}
