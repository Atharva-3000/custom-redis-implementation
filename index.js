const net = require("net");
const { parse } = require("path");
const Parser = require("redis-parser");

const store = {};
const expireTimers = new Map(); 
// For key expiration for things like set ex

const server = net.createServer((connection) => {
  console.log("Client connected");

  connection.on("data", (data) => {
    const parser = new Parser({
      returnReply: (reply) => {
        const command = reply[0].toLowerCase();
        
        switch (command) {
          case 'set': {
            const key = reply[1];
            const value = reply[2];
            
            // Check for additional SET options (EX, PX, NX, XX)
            let i = 3;
            while (i < reply.length) {
              const option = reply[i]?.toLowerCase();
              switch(option) {
                case 'ex': // Expire in seconds
                  const seconds = parseInt(reply[i + 1]);
                  setExpiration(key, seconds * 1000);
                  i += 2;
                  break;
                case 'px': // Expire in milliseconds
                  const milliseconds = parseInt(reply[i + 1]);
                  setExpiration(key, milliseconds);
                  i += 2;
                  break;
                default:
                  i++;
              }
            }
            
            store[key] = value;
            connection.write("+OK\r\n");
            break;
          }
          
          case 'get': {
            const key = reply[1];
            const value = store[key];
            
            if (value === undefined) {
              connection.write("$-1\r\n");
            } else {
              connection.write(`$${value.length}\r\n${value}\r\n`);
            }
            break;
          }

          case 'del': {
            const keys = reply.slice(1);
            let deleted = 0;
            
            for (const key of keys) {
              if (store.hasOwnProperty(key)) {
                delete store[key];
                if (expireTimers.has(key)) {
                  clearTimeout(expireTimers.get(key));
                  expireTimers.delete(key);
                }
                deleted++;
              }
            }
            
            connection.write(`:${deleted}\r\n`);
            break;
          }

          case 'exists': {
            const keys = reply.slice(1);
            const count = keys.filter(key => store.hasOwnProperty(key)).length;
            connection.write(`:${count}\r\n`);
            break;
          }

          case 'incr': {
            const key = reply[1];
            let value = parseInt(store[key] || '0');
            
            if (isNaN(value)) {
              connection.write("-ERR value is not an integer\r\n");
            } else {
              value++;
              store[key] = value.toString();
              connection.write(`:${value}\r\n`);
            }
            break;
          }

          case 'decr': {
            const key = reply[1];
            let value = parseInt(store[key] || '0');
            
            if (isNaN(value)) {
              connection.write("-ERR value is not an integer\r\n");
            } else {
              value--;
              store[key] = value.toString();
              connection.write(`:${value}\r\n`);
            }
            break;
          }

          case 'expire': {
            const key = reply[1];
            const seconds = parseInt(reply[2]);
            
            if (store.hasOwnProperty(key)) {
              setExpiration(key, seconds * 1000);
              connection.write(":1\r\n");
            } else {
              connection.write(":0\r\n");
            }
            break;
          }

          case 'ttl': {
            const key = reply[1];
            if (!store.hasOwnProperty(key)) {
              connection.write(":-2\r\n"); // Key doesn't exist
            } else if (!expireTimers.has(key)) {
              connection.write(":-1\r\n"); // Key exists but has no expire
            } else {
              const timer = expireTimers.get(key);
              const remaining = Math.ceil((timer._idleStart + timer._idleTimeout - Date.now()) / 1000);
              connection.write(`:${remaining}\r\n`);
            }
            break;
          }

          case 'keys': {
            const pattern = reply[1].replace(/\*/g, '.*').replace(/\?/g, '.');
            const regex = new RegExp(`^${pattern}$`);
            const matchingKeys = Object.keys(store).filter(key => regex.test(key));
            connection.write(`*${matchingKeys.length}\r\n`);
            matchingKeys.forEach(key => {
              connection.write(`$${key.length}\r\n${key}\r\n`);
            });
            break;
          }

          default: {
            connection.write("-ERR unknown command\r\n");
          }
        }
      },
      returnError: (err) => {
        console.log("Error: ", err);
        connection.write("-ERR " + err.message + "\r\n");
      },
    });
    
    parser.execute(data);
  });
});

// Helper function for key expiration
function setExpiration(key, milliseconds) {
  if (expireTimers.has(key)) {
    clearTimeout(expireTimers.get(key));
  }
  
  const timer = setTimeout(() => {
    delete store[key];
    expireTimers.delete(key);
  }, milliseconds);
  
  expireTimers.set(key, timer);
}

server.listen(8000, () => {
  console.log("Server started on PORT 8000");
});