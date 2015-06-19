var mongoose = require("mongoose");
var Joi = require("joi");
var passportLocalMongoose = require("passport-local-mongoose");
var moment = require("moment");
var _ = require("lodash");
var uuid = require("uuid");
var nodemailer = require("nodemailer");

var schema = {
  username : Joi.string().email().required(),
  password : Joi.string().required(),
}

var hawkTokenSchema = {
  userId : Joi.string().required(),
  tokenId : Joi.string().required(),
  key : Joi.string().required(),
  date : Joi.date().required()
}

var model = function() {
  var registered = false;
  var m;
  try {
    m = mongoose.model("User");
    registered = true;
  } catch(e) {
  }

  if (registered) return m;
  var schema = {
    username : {type : String, unique : true},
    password : String,
    isActive : Boolean,
  }
  var s = new mongoose.Schema(schema);
  s.plugin(passportLocalMongoose, {usernameField : "username", hashField : "password"});
  m = mongoose.model("User", s);
  return m;
}

var tokenModel = function() {
  var registered = false;
  var m;
  try {
    m = mongoose.model("HawkToken");
    registered = true;
  } catch(e) {
  }

  if (registered) return m;
  var schema = {
    userId : String,
    tokenId : String,
    key : String,
    expire : Date,
  }
  var s = new mongoose.Schema(schema);
  m = mongoose.model("HawkToken", s);
  return m;
}

var User = function(server, options, next) {
  this.server = server;
  
  var getCredentials = function(id, callback) {
    tokenModel().findOne({tokenId:id}, function(err, result) {
      if (err || !result) return callback(false, null);
      model().findOne({_id: result.userId }, function(err, user) {
        if (user.isActive) {
          // Check expire time
          if (moment().isBefore(result.expire)) {
            var credential = {
              username : user.username,
              userId : user._id,
              key : result.key,
              algorithm : "sha256"
            }
            // Renew expire time for each request.
            result.expire = moment().add(1, "day").format();
            result.save(function(err) {
              if (err || !result) return callback(false, null);
              return callback(null, credential);
            });
          } else {
            result.remove();
            return callback({
              error: "Unauthorized",
              message: "Expired token",
              statusCode: 401
            }, null)
          }
        } else {
          return callback({
            error: "Unauthorized",
            message: "Not active",
            statusCode: 401
          }, null)
        }
      })
    })
  }

  // Register hawk  
  server.register(require("hapi-auth-hawk"), function(err) {
    server.auth.strategy("default", "hawk", { getCredentialsFunc: getCredentials });
  });

  this.options = options || {};
  this.registerEndPoints();
}

User.prototype.registerEndPoints = function() {
  var self = this;
  self.server.route({
    method: "POST",
    path: "/api/users/login",
    // This /api/users/login is the only way to grab the pair key
    // Let the request pass here without auth
    handler: function(request, reply) {
      self.login(request, reply);
    },
  });
  self.server.route({
    method: "GET",
    path: "/api/users/logout",
    config : {
      auth: "default",
    },
    handler: function(request, reply) {
      self.logout(request, reply);
    },
  });
}

User.prototype.model = function() {
  return model();
}

User.prototype.tokenModel = function() {
  return tokenModel();
}

/**
  * @api {post} /api/users/login Login to get Hawk MAC
  * @apiName loginUser
  * @apiGroups Users
  *
  * @apiParam {String} username Username of the existing user
  * @apiParam {String} password Password of the existing user
  *
  * @apiSuccess {Object} result Result object
  * @apiSuccess {Number} result.success Boolean state, should true
  *
  * @apiError unauthorized {Object} result Result object
  * @apiError unauthorized {Object} result.statusCode 401
  * @apiError unauthorized {Object} result.error Error code
  * @apiError unauthorized {Object} result.message Description about the error
  *
  * If login attemp is succeeded, the server return a token in header.
  * This token contains an id and a key which separated by a space character.
  * In front-end side, they should be used to generate Hawk MAC which needed for next authorized request.
  * 
  * More about Hawk Auth : https://github.com/hueniverse/hawk
  *
**/

User.prototype.login = function(request, reply) {
  var self = this;
  model().authenticate()(
    request.payload.email, 
    request.payload.password, 
  function(err, user) {
    if (err) return reply(err);
    if (!user) {
      return reply({
        error: "Unauthorized",
        message: "Unknown credentials",
        statusCode: 401
      }).code(401);
    }
    if (!user.isActive) {
      return reply({
        error: "Unauthorized",
        message: "Not active",
        statusCode: 401
      }).code(401);
    }
    // Generate key pair for Hawk Auth
    tokenModel().create({
      userId : user._id,
      tokenId : uuid.v4(),
      key : uuid.v4(),
      expire : moment().add(1, "day").format()
    }, function(err, result) {
      if (err) return reply(err);
      var response = reply({success:true}).type("application/json").header("token", result.tokenId + " " + result.key).hold();
      response.send();
    })
  });
}

/**
  * @api {post} /api/users/logout Logout from system
  * @apiName logoutUser
  * @apiGroups Users
  *
  * @apiSuccess {Object} result Result object
  * @apiSuccess {Number} result.success Boolean state, should true
  * 
  * @apiError unauthorized {Object} result Result object
  * @apiError unauthorized {Object} result.statusCode 401
  * @apiError unauthorized {Object} result.error Error code
  * @apiError unauthorized {Object} result.message Description about the error
  *
  * This end point requires a Hawk MAC header
  *
**/

User.prototype.logout = function(request, reply) {
  // Remove token from db
  tokenModel().remove({key : request.auth.credentials.key, userId : request.auth.credentials.userId}, function(err, result){
    if (err) reply(err).code(400);
    reply({success: true}).type("application/json").statusCode = 200;
  });
}

User.prototype.create = function(request, cb) {
  if (_.isEmpty(request.payload)) {
    return reply({success:false}).code(400);
  }
  var self = this;
  var newUser = model();
  newUser.username = request.payload.email;
  newUser.isActive = false;
  model().register(newUser, request.payload.password, function(err, result) {
    if (err) return cb({error: err.name, message: err.message, statusCode: 400}, null);
    var user = {
      username : result.username,
      id : result.id
    }
    cb(null, user);
  })
}

User.prototype.setPassword = function(id, password, cb) {
  var self = this;
  model().findOne({_id:id}, function(err, user) {
    if (err) return cb(err, user);
    user.setPassword(password, function(err) {
      if (err) return cb(err, null);
      user.save(function(err, result) {
        cb(err, result);
      })
    })
  });
}

User.prototype.remove = function(id, cb) {
  model().remove({_id:id}, function(err, result) {
    cb(err, result); 
  });
}

User.prototype.activate = function(id, cb) {
  model().findOneAndUpdate({_id:id}, {isActive: true}, function(err, result) {
    cb(err, result); 
  });
}

User.prototype.deactivate = function(id, cb) {
  model().findOneAndUpdate({_id:id}, {isActive: false}, function(err, result) {
    cb(err, result); 
  });
}

exports.register = function(server, options, next) {
  new User(server, options, next);
  next();
};

exports.register.attributes = {
  pkg: require("./package.json")
};

exports.model = model;
exports.tokenModel = tokenModel;

exports.class = User.prototype;