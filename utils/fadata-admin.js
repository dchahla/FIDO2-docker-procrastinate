// convert the following to use firebase but export the same contract
const admin = require('firebase-admin')

var serviceAccount = require('./../cert/hiddenv-users-dev-firebase-adminsdk-bb8fu-95d1c17f80.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()

const commitmentsTable = db.collection('commitments')
const usersTable = db.collection('users')
const credentialsTable = db.collection('credentials')

module.exports = {
  commitmentsTable,
  usersTable,
  credentialsTable
}
