# real

links.txt          where i live. nothing else is me.
links.sig.json     links.txt signed as a nostr post by my nostr key.
links.txt.sshsig   links.txt signed by my ssh key.
blip-signing-key.pub

check the ssh one:

    echo "blip $(cat blip-signing-key.pub)" > allowed
    ssh-keygen -Y verify -f allowed -I blip -n file -s links.txt.sshsig < links.txt

check the nostr one at https://blip-yield.blipyield.workers.dev/real
or with any nostr tool.
