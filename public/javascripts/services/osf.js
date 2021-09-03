function osf_test() {
  const token = document.querySelector('#osf-token').value;
  const title = document.querySelector('#osf-title').value;
  const description = document.querySelector('#osf-description').value;
  const status = document.querySelector('#wnr2').checked;
  let osfProjectLink;
  if (!token) {
    alert('Enter OSF token');
    return;
  }

  osf_testBtn.disabled = true;
  osf_testBtn.style.backgroundColor = 'lightgrey';
  osf_testBtn.innerText = 'Connecting to OSF...';

  fetch('https://api.osf.io/v2/nodes/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      data: {
        type: 'nodes',
        attributes: {
          title,
          description,
          public: status,
          category: 'project',
        },
      },
    }),
  })
    .then((res) => {
      if (res && !res.ok) {
        alert('Wrong OSF token');
        window.location = '/osf';
        return;
      }
      return res.json();
    })
    .then((myJSON) => {
      const files_link = myJSON.data.relationships.files.links.related.href;
      osfProjectLink = `https://osf.io/${files_link.split('/')[5]}/files/`;
      osf_testBtn.innerText = 'Creating a new project...';
      return files_link;
    })
    .then((link) =>
      fetch(link, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
    )
    .then((second_res) => second_res.json())
    .then((second_JSON) => {
      const upload_link = second_JSON.data.filter(
        (d) => d.attributes.name === 'osfstorage'
      )[0].links.upload;
      osf_testBtn.innerText = 'New project created ...';
      return upload_link;
    })
    .then((link) =>
      // update the information about the project with osf_upload_link
      fetch('/updateprojectwithosfinfo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          osf: {
            upload_link: link,
            upload_token: token,
            title,
            project_link: osfProjectLink,
            policy: 'OSF-OL',
          },
        }),
      })
    )
    .then((res) => {
      osf_testBtn.innerText = 'Done';
      if (res.url && res.ok) {
        window.location = res.url;
      }
    })
    .catch((err) => {
      console.log(err);
    });
}

function remove_link() {
  const remove = confirm(
    'Are you sure you want to remove the link? It will not impact already saved data in the OSF project, but remove the link between Open Lab and OSF project. The action is not reversible.'
  );
  if (remove === true) {
    fetch('/updateprojectwithosfinfo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        osf: {
          upload_link: null,
          upload_token: null,
          title: null,
          project_link: null,
          policy: 'OL',
        },
      }),
    })
      .then((res) => {
        if (res.url && res.ok) {
          window.location = res.url;
        }
      })
      .catch((err) => {
        console.log(err);
      });
  }
}

function osf_connect() {
  const token = document.querySelector('#osf-token').value;
  const projectid = document.querySelector('#osf-project-code').value;
  if (!token) {
    alert('Enter OSF token');
    return;
  }
  if (!projectid) {
    alert('Enter OSF project ID');
    return;
  }
  osf_connectBtn.disabled = true;
  osf_connectBtn.style.backgroundColor = 'lightgrey';
  osf_connectBtn.innerText = 'Connecting to OSF...';

  let osfProjectLink;
  let projectTitle;

  fetch(`https://api.osf.io/v2/nodes/${projectid}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
    .then((res) => {
      if (res && !res.ok) {
        alert('Wrong credentials');
        window.location = '/osf';
        return;
      }
      return res.json();
    })
    .then((myJSON) => {
      const files_link = myJSON.data.relationships.files.links.related.href;
      osfProjectLink = `https://osf.io/${files_link.split('/')[5]}/files/`;
      projectTitle = myJSON.data.attributes && myJSON.data.attributes.title;
      osf_connectBtn.innerText = 'Connecting to the project...';
      return files_link;
    })
    .then((link) =>
      fetch(link, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
    )
    .then((second_res) => second_res.json())
    .then((second_JSON) => {
      const upload_link = second_JSON.data.filter(
        (d) => d.attributes.name === 'osfstorage'
      )[0].links.upload;
      osf_connectBtn.innerText = 'Project is connected ...';
      return upload_link;
    })
    .then((link) =>
      fetch('/updateprojectwithosfinfo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          osf: {
            upload_link: link,
            upload_token: token,
            title: projectTitle,
            project_link: osfProjectLink,
            policy: 'OSF-OL',
          },
        }),
      })
    )
    .then((res) => {
      osf_connectBtn.innerText = 'Done';
      if (res.url && res.ok) {
        window.location = res.url;
      }
    })
    .catch((err) => {
      console.log(err);
    });
}

const osf_testBtn = document.querySelector('#osf_testBtn');
if (osf_testBtn) osf_testBtn.addEventListener('click', osf_test);

const removeosfconnectionBtn = document.querySelector('#removeosfconnection');
if (removeosfconnectionBtn)
  removeosfconnectionBtn.addEventListener('click', remove_link);

const osf_connectBtn = document.querySelector('#osf_connectBtn');
if (osf_connectBtn) osf_connectBtn.addEventListener('click', osf_connect);
