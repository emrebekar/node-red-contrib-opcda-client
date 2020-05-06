module.exports = function(RED) {
	const opcda = require('node-opc-da');
	
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
		"string" : opcda.dcom.Types.STRING,
		"char" : opcda.dcom.Types.CHARACTER,
		"date" : opcda.dcom.Types.DATE,
		"currency" : opcda.dcom.Types.CURRENCY,
		"array" : opcda.dcom.Types.ARRAY
	};
    
	function OPCDAWrite(config) {
        RED.nodes.createNode(this,config);
        let node = this;
	
		node.config = config;
		
		let serverNode = RED.nodes.getNode(config.server);
		let opcItemMgr, opcSyncIO, opcGroup, serverHandle;
		
		let writing = false;
		
		if(!serverNode){
			updateStatus("error");
			node.error("Please select a server.")
			return;
		}
		
		serverNode.registerGroupNode(node);	
		
		if(serverNode.isConnected){
			var opts = {
				updateRate: parseInt(config.updaterate)
			};
			
			serverNode.opcServer.addGroup(config.id, opts).then(function(group){
				init(group);
			});
		}
		
		async function init(createdGroup){	
			try{
				reading = false;

				opcItemMgr = await createdGroup.getItemManager();
				opcSyncIO = await createdGroup.getSyncIO();
				
				var item = [{itemID: config.itemid, clientHandle: 1}];
				var addedItems = await opcItemMgr.add(item);
				var addedItem = addedItems[0];
				
				if (addedItem[0] !== 0) {
					node.warn(`Error adding item '${item.itemID}': ${errorMessage(addedItem[0])}`);
				} 
				else {
					serverHandle = addedItem[1].serverHandle;
				}
						
				updateStatus('ready');
			}
			catch(e){
				updateStatus("error");
                onError(e);
				serverNode.reconnect();
			}
		}
	
		async function destroy(){
			try {                
                if (opcItemMgr) {
                    await opcItemMgr.end();
                    opcItemMgr = null;
                }
                
                if (opcGroup) {
                    await opcGroup.end();
                    opcGroup = null;
                }
            } 
			catch (e) {
				updateStatus('error');
                onError(e);
            }
		}
		
		async function writeGroup(value){
			try{
				writing = true;
				updateStatus("writing");
				var object = [{
					value: value,
					handle: serverHandle,
					type: itemTypes[config.itemtype]
				}];
								
				await opcSyncIO.write(object);
				
				var msg = { payload: true };
				node.send(msg);	
				
				updateStatus("ready");
			}
			catch(e){
				updateStatus('writeerror');
				
				var msg = { payload: false };
				node.send(msg);	
                
				onError(e);
			}
			finally{
				writing = false;
			}
		}
		
		node.serverStatusChanged = async function serverStatusChanged(status){
			updateStatus(status);
			if(serverNode.isConnected){
				var opts = {
					updateRate: parseInt(config.updaterate)
				};
				
				var createdGroup = await serverNode.opcServer.addGroup(config.id, opts);
				init(createdGroup);
			}
			else{
				await destroy();
			}
		}

		function updateStatus(status){
			groupStatus = status;
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
				case "reading":
					node.status({fill:"blue",shape:"ring",text:"Reading"});
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
		
		function onError(e){
			var msg = errorMessage(e);
			node.error(msg);
		}
		
		function errorMessage(e){
			var msg = errorCode[e] ? errorCode[e] : e.message;
			return msg;
		}
		
		node.on('input', function(msg){
			if(serverNode.isConnected && !writing){
				writeGroup(msg.payload);	
			}
        });	
	
		node.on('close', function(){
			destroy();
			serverNode.removeListener("__server_status__");
			done();
		});
    }
	
    RED.nodes.registerType("opcda-write",OPCDAWrite);
}
