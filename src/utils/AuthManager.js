import React from 'react'
import FetchHelper from './FetchHelper'
import DripHelper from './DripHelper'
import PushNotifications from '../PushNotifications'
import jwtDecode from 'jwt-decode'
import moment from 'moment'

var isLoggedIn = false
var accessToken = null
var refreshToken = null
var currentUser = null
var userType = null

const KEY_ACCESS_TOKEN = 'accessToken'
const KEY_REFRESH_TOKEN = 'refreshToken'

export default class AuthManager {
  static isAuthenticated() {
    return AuthManager.isLoggedIn
  }

  static getAccessToken() {
    return AuthManager.accessToken
  }

  static getCurrentUser() {
    return AuthManager.currentUser
  }

  static isCustomer() {
    return AuthManager.userType == 'customer'
  }

  static _hasError(responseJson) {
    let hasError = false
    let tokens = responseJson.tokens

    if (!tokens) {
      hasError = true
    }

    if (tokens.length === 0) {
      hasError = true
    }

    if (!tokens.access) {
      hasError = true
    }

    if (!tokens.refresh) {
      hasError = true
    }

    return hasError
  }

  static registerCustomer(data) {
    return FetchHelper.post(global.Api.Customers, data, false, false)
      .then(responseJson => {
        if (this._hasError(responseJson)) {
          throw AuthManager.getError(responseJson)
        }
        AuthManager._updateTokens(responseJson.tokens)
        AuthManager._setUser(responseJson)
        PushNotifications.register(AuthManager.currentUser.user)
        DripHelper.trackUser()
        DripHelper.trackBasket()
        return responseJson
      })
      .catch(error => {
        throw AuthManager.getError(error)
      })
  }

  static socialLogin(data) {
    return FetchHelper.post(global.Api.SocialLogin, data, false, false)
      .then(responseJson => {
        if (this._hasError(responseJson)) {
          throw AuthManager.getError(responseJson)
        }
        AuthManager._updateTokens(responseJson.tokens)
        AuthManager._setUser(responseJson)
        PushNotifications.register(AuthManager.currentUser.user)
        DripHelper.trackUser()
        DripHelper.trackBasket()
        return responseJson
      })
      .catch(error => {
        throw AuthManager.getError(error)
      })
  }

  static login(email, password) {
    let data = { email, password }
    return FetchHelper.post(global.Api.Login, data, false, false)
      .then(responseJson => {
        if (this._hasError(responseJson)) {
          throw AuthManager.getError(responseJson)
        }
        if (!responseJson.customer) {
          alert('Only customer accounts can use this app')
        }
        AuthManager._updateTokens(responseJson.tokens)
        AuthManager._setUser(responseJson)
        PushNotifications.register(AuthManager.currentUser.user)
        DripHelper.trackUser()
        DripHelper.trackBasket()
        return responseJson
      })
      .catch(error => {
        throw AuthManager.getError(error)
      })
  }

  static _getMinutesUntilTokenExpiration() {
    var decodedJWT = jwtDecode(AuthManager.accessToken)
    var exp = decodedJWT.exp * 1000
    var expirationTime = moment(exp)
    var today = moment()
    let absoluteDifference = Math.abs(expirationTime.diff(today, 'minutes'))
    return absoluteDifference
  }

  static async validateTokens(onSuccess, onError) {
    let remainingMinutes = AuthManager._getMinutesUntilTokenExpiration()
    if (remainingMinutes > 1) {
      onSuccess()
      return
    }
    return AuthManager.refreshTokens(() => {
      return onSuccess()
    }).catch(error => {
      onError()
      this.props.history.push('/user/login')
    })
  }

  static refreshTokens() {
    return AuthManager.getRefreshToken()
      .then(refreshToken => {
        if (!refreshToken) {
          throw { message: 'No Refresh Token Found' }
          return
        }
        // try and refresh the token if we find it, if this fails
        // our token has expired and we will need user to re login
        // manually
        const data = { refresh: refreshToken }

        return FetchHelper.post(global.Api.RefreshToken, data, false, false)
      })
      .then(tokenResponse => {
        return AuthManager._updateTokens(tokenResponse)
      })
  }

  static getCredentials() {
    return new Promise((resolve, reject) => {
      try {
        let credentialsString = localStorage.getItem('credentials')
        if (credentialsString == null) {
          reject({ message: 'Not logged in' })
        }
        let credentials = JSON.parse(credentialsString)
        resolve(credentials)
      } catch (error) {
        reject(error)
      }
    })
  }

  static getRefreshToken() {
    return AuthManager.getCredentials().then(credentials => {
      return credentials.refreshToken
    })
  }

  static silentLogin() {
    return AuthManager.refreshTokens()
      .then(() => {
        return FetchHelper.get(global.Api.UserInfo)
      })
      .then(responseJson => {
        AuthManager._setUser(responseJson)
        return AuthManager.currentUser
      })
      .catch(error => {
        AuthManager.accessToken = null
        AuthManager.refreshToken = null
        throw error
      })
  }

  static refreshCurrentUser() {
    return FetchHelper.get(global.Api.UserInfo)
      .then(responseJson => {
        AuthManager._setUser(responseJson)
        return AuthManager.currentUser
      })
      .catch(error => {
        throw error
      })
  }

  static async logOut() {
    let data = { refresh: AuthManager.refreshToken }
    return FetchHelper.post(global.Api.Logout, data).then(() => {
      return AuthManager.removeCredentials()
    })
  }

  static requestResetPassword(email) {
    return FetchHelper.post(
      global.Api.RequestResetPassword,
      {
        email
      },
      false,
      false
    )
  }

  static resetPassword(email, password, code) {
    let data = {
      email,
      password,
      verification_code: code
    }
    return FetchHelper.post(global.Api.ResetPassword, data, false, false)
  }

  static removeCredentials() {
    AuthManager.accessToken = null
    AuthManager.refreshToken = null
    AuthManager.isLoggedIn = false
    AuthManager.currentUser = null
    AuthManager.userType = null
    return localStorage.clear()
  }

  static getError(error) {
    var errorMessage = 'An unexpected error occured'
    if (error.email) {
      errorMessage = error.email[0]
    } else if (error.message) {
      errorMessage = error.message
    } else if (error.non_field_errors) {
      errorMessage = error.non_field_errors[0]
    } else if (error.detail) {
      errorMessage = error.detail
    }
    return { error: errorMessage, message: errorMessage }
  }

  static _updateTokens(tokens) {
    AuthManager.accessToken = tokens.access
    AuthManager.refreshToken = tokens.refresh
    let values = {
      token: AuthManager.token,
      refreshToken: AuthManager.refreshToken
    }
    localStorage.setItem('credentials', JSON.stringify(values))
  }

  static _setUser(responseJson) {
    AuthManager.isLoggedIn = true
    if (responseJson.customer) {
      AuthManager.currentUser = responseJson.customer
      AuthManager.userType = 'customer'
      return
    }
  }

  static getHeaders(contentType = 'application/json') {
    var headers = {}
    if (contentType === 'application/json') {
      headers = { 'Content-Type': contentType }
    }
    if (AuthManager.accessToken) {
      headers['Authorization'] = 'Bearer ' + AuthManager.accessToken
    }

    return new Headers(headers)
  }

  static updatePhone(data) {
    let id = data.id;
    delete data.id;
    return FetchHelper.patch(`${global.Api.Customers}/${id}`, data)
  }

  static requestPhoneVerification() {
    return FetchHelper.post(global.Api.RequestPhoneVerification, {})
  }

  static verifyPhone(data) {
    return FetchHelper.post(global.Api.VerifyPhone, data)
  }
}
