var InMemory = function(){
  if (InMemory.prototype._singleton) {
    return InMemory.prototype._singleton;
  }

  InMemory.prototype._singleton = this;
  this.tokens = {};
  this.keys = {};
}

InMemory.prototype.set = function(token) {
  var self = this;
  self.keys[token.key] = token;
  self.tokens[token.tokenId] = token;
  console.log(self.tokens);
}
InMemory.prototype.unset = function(key) {
  var self = this;
  var token = self.keys[key];
  delete(self.keys[key]);
  delete(self.tokens[token.tokenId]);
  console.log(self.tokens);
}
InMemory.prototype.getToken = function(id) {
  var self = this;
  return self.tokens[id];
}
InMemory.prototype.getKey = function(id) {
  var self = this;
  return self.keys[id];
}

module.exports = InMemory;
