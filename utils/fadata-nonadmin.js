// convert the following to use firebase but export the same contract

// hiddenv-users-dev-firebase-adminsdk-bb8fu-95d1c17f80.json
const firebase = require('firebase/app')
require('firebase/firestore')

const {
  FIREBASE_API_KEY: apiKey,
  FIREBASE_AUTH_DOMAIN: authDomain,
  FIREBASE_PROJECT_ID: projectId,
  FIREBASE_STORAGE_BUCKET: storageBucket,
  FIREBASE_MESSAGING_SENDER_ID: messagingSenderId,
  FIREBASE_APP_ID: appId
} = process.env

const firebaseConfig = {
  apiKey,
  authDomain,
  projectId,
  storageBucket,
  messagingSenderId,
  appId
}

firebase.initializeApp(firebaseConfig)
const db = firebase.firestore()

const commitmentsTable = db.collection('commitments')
const usersTable = db.collection('users')
const credentialsTable = db.collection('credentials')

module.exports = {
  commitmentsTable,
  usersTable,
  credentialsTable
}
