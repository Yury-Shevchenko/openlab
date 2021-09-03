// register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/service-worker.js')
    .then(function (registration) {
      // console.log("SW registered")
    })
    .catch(function (error) {
      // console.error(error);
    });
} else {
  // console.log("SW is not supported");
}

window.onbeforeinstallprompt = function (beforeInstallPromptEvent) {
  beforeInstallPromptEvent.preventDefault();
  const installButton = document.querySelector('#installApp');
  if (installButton) {
    installButton.style.display = 'block';
    installButton.addEventListener('click', function (mouseEvent) {
      // installButton.disabled = true;
      beforeInstallPromptEvent.prompt();
      beforeInstallPromptEvent.userChoice.then(function (choiceResult) {
        if (choiceResult.outcome === 'dismissed') {
          // console.log('User cancelled installation');
          installButton.disabled = true;
        } else {
          // console.log('User added to home screen');
          installButton.style.display = 'none';
        }
      });
    });
  }
};

// activate notification
// function showNotification(){
//   if (typeof(diferredPrompt) !== 'undefined' && diferredPrompt) {
//     // console.log('diferredPrompt', diferredPrompt);
//     deferredPrompt.prompt();
//     deferredPrompt.userChoice.then(function(choiceResult){
//       // console.log(choiceResult.outcome);
//       if(choiceResult.outcome === 'dismissed') {
//         // console.log('User cancelled installation');
//       } else {
//         // console.log('User added to home screen');
//       }
//     });
//     deferredPrompt = null;
//   }
// }
