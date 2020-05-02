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
    
	function OPCDAWrite(config) {
        RED.nodes.createNode(this,config);
        let node = this;
	
		node.config = config;
		
		let serverNode = RED.nodes.getNode(config.server);
		let opcItemMgr, opcSyncIO, opcGroup, serverHandle;
		
		let writing = false;
		let unsuccessfulWrite = 0;
		
		if(!serverNode){
			updateStatus("grouperror");
			node.error("Please select a server.")
			return;
		}
		
		serverNode.addGroupNode(this);
		
		if(serverNode.isConnected){
			serverNode.reconnect();
		}
		
		serverNode.addListener("__server_status__", function(status) {
			updateStatus(status);
		});
		
		node.init = async function init(createdGroup){	
			try{
				reading = false;

				opcItemMgr = await createdGroup.getItemManager();
				opcSyncIO = await createdGroup.getSyncIO();
				
				var item = [{itemID: config.groupitem, clientHandle: 1}];
				var addedItems = await opcItemMgr.add(item);
				var addedItem = addedItems[0];
				
				if (addedItem[0] !== 0) {
					node.warn(`Error adding item '${item.itemID}': ${errorMessage(addedItem[0])}`);
				} 
				else {
					serverHandle = addedItem[1].serverHandle;
				}
						
				updateStatus('ready');
				unsuccessfulRead = 0;
			}
			catch(e){
				updateStatus('grouperror');
                onError(e);
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
				updateStatus('grouperror');
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
					type: opcda.dcom.Types.INTEGER
				}];
								
				await opcSyncIO.write(object);
				
				updateStatus("ready");
				unsuccessfulWrite = 0;
			}
			catch(e){
				unsuccessfulWrite++;
				updateStatus('writeerror');
                onError(e);
			}
			finally{
				writing = false;
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
				case "writing":
					node.status({fill:"blue",shape:"ring",text:"Writing Data"});
					break;
				case "servererror":
					node.status({fill:"red",shape:"ring",text:"Server Error"});
					break;
				case "grouperror":
					node.status({fill:"red",shape:"ring",text:"Group Error"});
					break;
				case "writeerror":
					node.status({fill:"red",shape:"ring",text:"Write Error"});
					break;
				default:
					node.status({fill:"grey",shape:"ring",text:"Unknown"});
					break;
			}
		}
		
		function onError(e){
			var msg = errorMessage(e);
			node.error(msg);
			console.log(e);

			
			unsuccessfulWrite++;
			if(unsuccessfulWrite > parseInt(config.retry)){
				serverNode.reconnect();
				unsuccessfulWrite = 0;
			}
		}
		
		function errorMessage(e){
			var msg = errorCode[e] ? errorCode[e] : e.message;
			return msg;
		}
		
		node.on('input', function(msg){
			if(serverNode.isConnected && !writing){
				writeGroup(msg.payload);
				//console.log(msg.payload);
			}
			
			else{
				onError(new Error("Reading is unsuccesful."));
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
