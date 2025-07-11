const crypto = require('crypto');

function generateWalmartSignature(consumerId, privateKeyBase64, keyVersion) {
  const timestamp = Date.now().toString();
  const canonicalString = `${consumerId}\n${timestamp}\n${keyVersion}\n`;

  const privateKeyPEM = Buffer.from(privateKeyBase64, 'base64').toString('utf-8');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(canonicalString);
  signer.end();

  const signature = signer.sign(privateKeyPEM, 'base64');

  return { signature, timestamp, keyVersion };
}

module.exports = generateWalmartSignature;
