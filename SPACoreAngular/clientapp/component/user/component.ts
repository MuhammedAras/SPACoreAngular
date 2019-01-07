import { Component, OnInit } from '@angular/core';
import { FormGroup, FormControl, Validators, FormBuilder } from '@angular/forms';

import { UserModel } from './model';
import { UserService } from './service';
import { error } from '@angular/compiler/src/util';
@Component({
    selector: 'my-app',
    templateUrl: './app/component/user/user.html',
    providers: [UserService]
})
export class UserComponent implements OnInit {
    public user: UserModel;
    public users: UserModel[];
    public resmessage: string;
    userForm: FormGroup;

    constructor(private formBuilder: FormBuilder, private userService: UserService) { }

    ngOnInit() {

        this.userForm = this.formBuilder.group({
            id: 0,
            firstName: new FormControl('', Validators.required),
            lastName: new FormControl('', Validators.required),
            email: new FormControl('', Validators.compose([
                Validators.required,
                Validators.pattern('^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+.[a-zA-Z0-9-.]+$')
            ])),
            phone: new FormControl('', Validators.required)

        });
        this.getAll();
    }
    onSubmit() {
        if (this.userForm.invalid) {
            return;
        }
    }

    //Get All User
    getAll() {
        //debugger
        this.userService.getAll().subscribe(
            response => {
                console.log(response);
                this.users = response;
            }, error => {
                console.log(error);
            }
        );
    }

    //Get By ID
    edit(e, m) {
        e.preventDefault();
        this.userService.getByID(m.id)
            .subscribe(response => {
                this.user = response;
                this.userForm.setValue({
                    id: this.user.id,
                    firstName: this.user.firstName,
                    lastName: this.user.lastName,
                    email: this.user.email,
                    phone: this.user.phone
                });

            }, error => {
                console.log(error);
            });
    }

    save() {
        //debugger
        this.userService.save(this.userForm.value)
            .subscribe(response => {
                this.resmessage = response;
                this.getAll();
                this.reset();
            }, error => {
                console.log(error);
            });
    }
    //Delete
    delete(e, m) {
        e.preventDefault();
        var IsConf = confirm('You are about to delete ' + m.firstname + '. Are you sure?');
        if (IsConf) {
            this.userService.delete(m.id)
                .subscribe(response => {
                    this.resmessage = response;
                    this.getAll();
                }, error => {
                    console.log(error);
                });
        }
    }

    reset() {
        this.userForm.setValue({
            id: 0,
            firstName: null,
            lastName: null,
            email: null,
            phone: null
        });  
    }
}