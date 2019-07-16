const enableNotificationsButton = document.querySelector('#enable_notifications');
const disableNotificationsButton = document.querySelector('#disable_notifications');
const notificationStatus = document.querySelector('#notification_status');

function displayConfirmNotification(){
  if('serviceWorker' in navigator){
    var options = {
      body: 'You are successfully subscribed to Open Lab notification service',
      dir: 'ltr',
      lang: 'en-US',//BCP 47
      vibrate: [100, 50, 200],//vibration pause vibration in ms
      //- badge: '/src/images/icons/app-icon-96x96.png',
      tag: 'confirm-notification',//id for notification, notifications with the same tag will be stacked together - good not to spam user
      renotify: true,//even if you need the same tag, the phone will vibrate and notify. (if false - very passive notification)
      //- actions: [//might not be displayed
      //-   {action: 'confirm', title: 'Okay', icon: '/src/images/icons/app-icon-96x96.png'},
      //-   {action: 'cancel', title: 'Cancel', icon: '/src/images/icons/app-icon-96x96.png'},
      //- ]
    };
    notificationStatus.innerText = "You are subscribed to notifications";
    enableNotificationsButton.style.display = "none";
    disableNotificationsButton.style.display = "inline-block";
    navigator.serviceWorker.ready
      .then(swreg => {
        swreg.showNotification('Successfully subscribed!', options)
      })
  }
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);

  for (var i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function configurePushSub(){
  if(!('serviceWorker' in navigator)){
    return;
  }
  var reg;
  navigator.serviceWorker.register('/service-worker.js').then(function () {
    return navigator.serviceWorker.ready
  })
    .then(swreg => {
      reg = swreg;
      return swreg.pushManager.getSubscription();//check subscription of this browser and this device
    })
    .then(sub => {
      if(sub === null){
        var vapidPublicKey = 'BJ-KXZLw9zvIdVFMGpmiasjO4q9KVZIhAHHresr5AJv32rnnGicDdk13YizCJDR51TTNTfah29McZQB-FOHtQhA';
        var convertedVapidPublicKey = urlBase64ToUint8Array(vapidPublicKey);
        //Create new subscription
        return reg.pushManager.subscribe({
          userVisibleOnly: true,//push notifications are only visible to the user
          applicationServerKey: convertedVapidPublicKey,
        });
      } else {
        //Already have subscription
        notificationStatus.innerText = "You are subscribed to notifications";
        enableNotificationsButton.style.display = "none";
        console.log("You already have subscription", sub);
        throw new Error("You already have subscription");
      }
    })
    .then(newSub => {
      if(typeof(newSub) !== 'undefined'){
        //pass subscription to the database through a post request
        console.log('New subscription', JSON.stringify(newSub));
        return fetch('/registernotification', {
          method:'POST',
          headers: {
            'Content-Type':'application/json',
            'Accept':'application/json',
          },
          body: JSON.stringify(newSub),
          credentials: 'include'
        })
      }
    })
    .then(res => {
      console.log('Results from server are received', res);
      if(res && res.ok){
        displayConfirmNotification();
      }
      // return res.json();
    })
    // .then(data => {
    //   console.log('data received', data);
    // })
    .catch(err => {
      console.error(err);
    })
}

function askForNotificationPermission(){
  Notification.requestPermission()
    .then((result)=>{
      if (result === 'denied') {
        alert("You disabled notifications. To allow notifications, change the settingd of your browser.")
        console.log('Permission wasn\'t granted. Allow a retry.');
        return;
      }
      if (result === 'default') {
        console.log('The permission request was dismissed.');
        return;
      }
      configurePushSub();
    })
};

function sendNotification(){
  console.log('Sending test notification');
  fetch('/sendnotification', {
    method:'POST',
    headers: {
      'Content-Type':'application/json',
      'Accept':'application/json',
    },
    body: JSON.stringify({title: 'New post', message: 'New message'})
  })
}


function unsubscribeNotifications() {
  if(!('serviceWorker' in navigator)){
    return;
  }
  var reg;
  navigator.serviceWorker.register('/service-worker.js').then(function () {
    return navigator.serviceWorker.ready
  })
    .then(swreg => {
      reg = swreg;
      return swreg.pushManager.getSubscription();//check subscription of this browser and this device
    })
    .then(function(subscription) {
      if (subscription) {
        return subscription.unsubscribe();
      }
    })
    .then(function(sub) {
      if(sub){
        return fetch('/unregisternotification', {
          method:'POST',
          credentials: 'include'
        })
      }
    })
    .then(res => {
      console.log('Results from server are received', res);
      alert("You are unsubscribed");
      enableNotificationsButton.style.display = "inline-block";
      disableNotificationsButton.style.display = "none";
      notificationStatus.innerText = "Please subscribe to receive notifications about the tests";
    })
    .catch(err => {
      console.error(err);
    })
}

function checkNotificationSubscription() {
  if(!('serviceWorker' in navigator)){
    return;
  }
  var reg;

  navigator.serviceWorker.register('/service-worker.js').then(function () {
    console.log("Trying register")
    return navigator.serviceWorker.ready
  })
    .then(function (swreg) {
      if (navigator.serviceWorker.controller) {
        console.log("ready", swreg)
        reg = swreg;
        return swreg.pushManager.getSubscription();//check subscription of this browser and this device
      } else {
        var listener = navigator.serviceWorker.addEventListener('controllerchange', () => {
          navigator.serviceWorker.removeEventListener('controllerchange', listener)
          console.log("now ready - do something", swreg)
          reg = swreg;
          return swreg.pushManager.getSubscription();
        })
      }
    })
    .then(sub => {
      if(sub === null){
        notificationStatus.innerText = "Please subscribe to receive notifications about the tests";
        enableNotificationsButton.style.display = "inline-block";
      } else {
        notificationStatus.innerText = "You are subscribed to notifications";
        disableNotificationsButton.style.display = "inline-block";
      }
    })
    .catch(err => {
      console.error(err);
    })
};

window.addEventListener('load', function() {
  if ('Notification' in window && 'serviceWorker' in navigator) {
    enableNotificationsButton.addEventListener('click', askForNotificationPermission);
    disableNotificationsButton.addEventListener('click', unsubscribeNotifications);
    checkNotificationSubscription();
  }
})


//
// var isPushEnabled = false;
//
// window.addEventListener('load', function() {
//   var pushButton = document.querySelector('.js-push-button');
//   pushButton.addEventListener('click', function() {
//     if (isPushEnabled) {
//       unsubscribe();
//     } else {
//       subscribe();
//     }
//   });
//
//   // Check that service workers are supported, if so, progressively
//   // enhance and add push messaging support, otherwise continue without it.
//   if ('serviceWorker' in navigator) {
//     navigator.serviceWorker.register('/service-worker.js')
//     .then(initialiseState);
//   } else {
//     console.warn('Service workers aren\'t supported in this browser.');
//   }
// });
//
// // Once the service worker is registered set the initial state
// function initialiseState() {
//   // Are Notifications supported in the service worker?
//   if (!('showNotification' in ServiceWorkerRegistration.prototype)) {
//     console.warn('Notifications aren\'t supported.');
//     return;
//   }
//
//   // Check the current Notification permission.
//   // If its denied, it's a permanent block until the
//   // user changes the permission
//   if (Notification.permission === 'denied') {
//     console.warn('The user has blocked notifications.');
//     return;
//   }
//
//   // Check if push messaging is supported
//   if (!('PushManager' in window)) {
//     console.warn('Push messaging isn\'t supported.');
//     return;
//   }
//
//   // We need the service worker registration to check for a subscription
//   navigator.serviceWorker.ready.then(function(serviceWorkerRegistration) {
//     // Do we already have a push message subscription?
//     serviceWorkerRegistration.pushManager.getSubscription()
//       .then(function(subscription) {
//         // Enable any UI which subscribes / unsubscribes from
//         // push messages.
//         var pushButton = document.querySelector('.js-push-button');
//         pushButton.disabled = false;
//
//         if (!subscription) {
//           // We aren't subscribed to push, so set UI
//           // to allow the user to enable push
//           return;
//         }
//
//         // Keep your server in sync with the latest subscriptionId
//         //check here whether the subsciption is saved properly in the project
//         sendSubscriptionToServer(subscription);
//
//         // Set your UI to show they have subscribed for
//         // push messages
//         pushButton.textContent = 'Disable Push Messages';
//         isPushEnabled = true;
//       })
//       .catch(function(err) {
//         console.warn('Error during getSubscription()', err);
//       });
//   });
// }
//
// function subscribe() {
//   // Disable the button so it can't be changed while
//   // we process the permission request
//   var pushButton = document.querySelector('.js-push-button');
//   pushButton.disabled = true;
//
//   navigator.serviceWorker.ready.then(function(serviceWorkerRegistration) {
//     serviceWorkerRegistration.pushManager.subscribe()
//       .then(function(subscription) {
//         // The subscription was successful
//         isPushEnabled = true;
//         pushButton.textContent = 'Disable Push Messages';
//         pushButton.disabled = false;
//
//         // TODO: Send the subscription.endpoint to your server
//         // and save it to send a push message at a later date
//         return sendSubscriptionToServer(subscription);
//       })
//       .catch(function(e) {
//         if (Notification.permission === 'denied') {
//           // The user denied the notification permission which
//           // means we failed to subscribe and the user will need
//           // to manually change the notification permission to
//           // subscribe to push messages
//           console.warn('Permission for Notifications was denied');
//           pushButton.disabled = true;
//         } else {
//           // A problem occurred with the subscription; common reasons
//           // include network errors, and lacking gcm_sender_id and/or
//           // gcm_user_visible_only in the manifest.
//           console.error('Unable to subscribe to push.', e);
//           pushButton.disabled = false;
//           pushButton.textContent = 'Enable Push Messages';
//         }
//       });
//   });
// }
