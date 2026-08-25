export function assertMessagingPublisher(value) {
  if (!value || typeof value.publish !== 'function') {
    throw new TypeError('MessagingPublisher port requires publish()');
  }
  return value;
}

export function assertMessagingConsumer(value) {
  if (!value || typeof value.subscribe !== 'function') {
    throw new TypeError('MessagingConsumer port requires subscribe()');
  }
  return value;
}

export function createMessagingPorts({ publisher, consumer }) {
  return Object.freeze({
    publisher: assertMessagingPublisher(publisher),
    consumer: assertMessagingConsumer(consumer),
  });
}
