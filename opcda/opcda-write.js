module.exports = function(RED) {
	const opcda = require('node-opc-da');
	const { OPCServer } = opcda;
    const { ComServer, Session, Clsid, ComString} = opcda.dcom;
	
	const errorCode = {
		0x80040154 : "Clsid is not found.",
		0x00000005 : "Access denied. Username and/or password might be wrong.",
		0xC0040006 : "The Items AccessRights do not allow the operation.",
		0xC0040004 : "The server cannot convert the data between the specified format/ requested data type and the canonical data type.",
		0xC004000C : "Duplicate name not allowed.",
		0xC0040010 : "The server's configuration file is an invalid format.",
		0xC0040009 : "The filter string was not valid",
		0xC0040001 : "The value of the handle is invalid. Note: a client should never pass an invalid handle to a server. If this error occurs, it is due to a programming error in the client or possibly in the server.",
		0xC0040008 : "The item ID doesn't conform to the server's syntax.",
		0xC0040203 : "The passed property ID is not valid for the item.",
		0xC0040011 : "Requested Object (e.g. a public group) was not found.",
		0xC0040005 : "The requested operation cannot be done on a public group.",
		0xC004000B : "The value was out of range.",
		0xC0040007 : "The item ID is not defined in the server address space (on add or validate) or no longer exists in the server address space (for read or write).",
		0xC004000A : "The item's access path is not known to the server.",
		0x0004000E : "A value passed to WRITE was accepted but the output was clamped.",
		0x0004000F : "The operation cannot be performed because the object is being referenced.",
		0x0004000D : "The server does not support the requested data rate but will use the closest available rate.",
		0x00000061 : "Clsid syntax is invalid"
	};
	
	const itemTypes = {
		"double" : opcda.dcom.Types.DOUBLE,
		"short" : opcda.dcom.Types.SHORT,
		"integer" : opcda.dcom.Types.INTEGER,
		"float" : opcda.dcom.Types.FLOAT,
		"byte" : opcda.dcom.Types.BYTE,
		"long" : opcda.dcom.Types.LONG,
		"boolean" : opcda.dcom.Types.BOOLEAN,
		"uuid" : opcda.dcom.Types.UUID,
		"string" : opcda.dcom.Types.COMSTRING,
		"char" : opcda.dcom.Types.CHARACTER,
		"date" : opcda.dcom.Types.DATE,
		"currency" : opcda.dcom.Types.CURRENCY,
		"array" : opcda.dcom.Types.ARRAY
	};
    
	function OPCDAWrite(config) {
        RED.nodes.createNode(this,config);
        let node = this;
			
		let server = RED.nodes.getNode(config.server);

		node.opcItemMgr = null;
		node.opcSyncIO = null;
		node.opcGroup = null;

		let clientHandle = 0;

		let serverHandles = {};
		
		node.isConnected = false;
		node.isWriting = false;
		
		if(!server){
			node.error("Please select a server.");
			return;
		}

		if (!server.credentials) {
            node.error("Failed to load credentials!");
			return;
        }	
		
		node.updateStatus = function(status){
			switch(status){
				case "disconnected":
					node.status({fill:"red",shape:"ring",text:"Disconnected"});
					break;
				case "connecting":
					node.status({fill:"yellow",shape:"ring",text:"Connecting"});
					break;
				case "ready":
					node.status({fill:"green",shape:"ring",text:"Ready"});
					break;
				case "writing":
					node.status({fill:"blue",shape:"ring",text:"Writing"});
					break;
				case "error":
					node.status({fill:"red",shape:"ring",text:"Error"});
					break;
				case "mismatch":
					node.status({fill:"yellow",shape:"ring",text:"Mismatch"});
					break;
				default:
					node.status({fill:"grey",shape:"ring",text:"Unknown"});
					break;
			}
		}	

		node.init = function(){
			return new Promise(async function(resolve, reject){
				if(!node.isConnected){

					try{
						node.updateStatus('connecting');
						var timeout = parseInt(server.config.timeout);
						var comSession = new Session();
						comSession = comSession.createSession(server.config.domain, server.credentials.username, server.credentials.password);
						comSession.setGlobalSocketTimeout(timeout);
	
						node.tout = setTimeout(function(){
							node.updateStatus("timeout");
							reject("Connection Timeout");
						}, timeout);
			
						node.comServer = new ComServer(new Clsid(server.config.clsid), server.config.address, comSession);	
						await node.comServer.init();
			
						var comObject = await node.comServer.createInstance();
						node.opcServer = new OPCServer();
						await node.opcServer.init(comObject);
	
						clearTimeout(node.tout);
				
						serverHandles = [];
						clientHandles = [];
						node.opcGroup = await node.opcServer.addGroup(config.id, null);				
						node.opcItemMgr = await node.opcGroup.getItemManager();
						node.opcSyncIO = await node.opcGroup.getSyncIO();
		
						node.isConnected = true;
	
						node.updateStatus('ready');
	
						resolve();
					}
					catch(e){
						reject(e);
					}	
				}
			});
		}
	
		node.destroy = function(){
			return new Promise(async function(resolve){
				try{
					node.isConnected = false;

					if (node.opcSyncIO) {
						await node.opcSyncIO.end();
						node.opcSyncIO = null;
					}
					
					if (node.opcItemMgr) {
						await node.opcItemMgr.end();
						node.opcItemMgr = null;
					}
					
					if (node.opcGroup) {
						await node.opcGroup.end();
						node.opcGroup = null;
					}
		
					if(node.opcServer){
						node.opcServer.end();
						node.opcServer = null;
					}
		
					if(node.comServer){
						node.comServer.closeStub();
						node.comServer = null;
					}
		
					resolve();
				}
				catch(e){
					reject(e);
				}
			});
		}
		
		async function writeGroup(itemValues){
			
			try{
				node.isWriting = true;
				node.updateStatus("writing");
				
				var objects = [];
				for(itemValue of itemValues){
					if(!(itemValue.itemID in serverHandles)){
						clientHandle++;
						var item = [{itemID: itemValue.itemID, clientHandle: clientHandle}];
						var addedItem = await node.opcItemMgr.add(item);

						if ((addedItem[0])[0] !== 0) {
							node.warn(`Error adding item '${item[0].itemID}'`);
						} 

						else {
							serverHandles[itemValue.itemID] = (addedItem[0])[1].serverHandle;
						}
					}

					var object = {
						value: itemValue.type == 'string' ? new ComString(itemValue.value, null) : itemValue.value,
						handle: serverHandles[itemValue.itemID],
						type: itemTypes[itemValue.type]
					};
					
					objects.push(object);
				}

				await node.opcSyncIO.write(objects);
				
				var msg = { payload: true };
				node.send(msg);	
				
				node.updateStatus("ready");
			}
			catch(e){
				node.error("opcda-error", e.message);
				node.updateStatus('error');

				node.reconnect();

				var msg = { payload: false };
				node.send(msg);	
			}
			finally{
				node.isWriting = false;
			}
		}

		node.isReconnecting = false;
		node.reconnect = async function(){
			try{
				if(!node.isReconnecting){
					node.isReconnecting = true;
					await node.destroy();
					await new Promise(resolve => setTimeout(resolve, 3000));
					await node.init();
					node.isReconnecting = false;
				}

				node.comServer.on('disconnected',async function(){
					node.isConnected = false;
					node.updateStatus('disconnected');
					await node.reconnect();
				});
			}
			catch(e){
				node.isReconnecting = false;
				if(errorCode[e]){
					switch(e) {
						case 0x00000005:
						case 0xC0040010:
						case 0x80040154:
						case 0x00000061:
							node.error(errorCode[e]);
							return;
						default:
							node.error(errorCode[e]);
							await node.reconnect();
					}
				}
				else{
					node.error(e);
					await node.reconnect();
				}				
			}
		}
		
		node.reconnect();
		
		node.on('input', function(msg){
			if(node.isConnected && !node.isWriting){
				writeGroup(msg.payload);	
			}
        });	
	
		node.on('close', function(done){
			node.status({});
			node.destroy().then(function(){
				done();
			});
		});
    }
	
    RED.nodes.registerType("opcda-write",OPCDAWrite);
}
