package calc;

import calc.DTO.UserDTO;
import calc.entity.User;
import calc.repository.UserRepository;
import calc.service.UserService;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestExecutionListeners;
import org.springframework.test.context.junit4.SpringRunner;

/**
 * Created by clementperez on 11/05/18.
 */

import org.junit.Before;
import org.mockito.Mockito;
import org.mockito.internal.verification.VerificationModeFactory;
import org.springframework.test.context.support.DependencyInjectionTestExecutionListener;
import org.springframework.test.context.support.DirtiesContextTestExecutionListener;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

/*@SpringBootTest
//@PropertySource(value = {"classpath:application.properties", "${api.config.location}"}, ignoreResourceNotFound = true)
@TestExecutionListeners(inheritListeners = false, listeners = {
        DependencyInjectionTestExecutionListener.class,
        DirtiesContextTestExecutionListener.class
})
@RunWith(SpringRunner.class)*/
public class UserRepositoryTest {

    @Autowired
    private UserService userService;

    @Autowired
    private UserRepository userRepository;

    List<User> allUsers ;

    //@Before
    public void setUp() {

        allUsers = new ArrayList<>();

        allUsers.add(userRepository.save(makeRandomUser()));
        allUsers.add(userRepository.save(makeRandomUser()));
        allUsers.add(userRepository.save(makeRandomUser()));
        allUsers.add(userRepository.save(makeRandomUser()));
        allUsers.add(userRepository.save(makeRandomUser()));


        //assertThat(userRepository.findByOutcomesUserUserName(john.getUserName())).is(john);
/*        Mockito.when(userRepository.findByOutcomesUserUserName(john.getUserName())).thenReturn(john);
        Mockito.when(userRepository.findByOutcomesUserUserName(alex.getUserName())).thenReturn(alex);
        Mockito.when(userRepository.findByOutcomesUserUserName("wrong_name")).thenReturn(null);
       // Mockito.when(userRepository.findByOutcomeUserUserId(john.getUserId()).orElse(null)).thenReturn(john);
        Mockito.when(userRepository.findAll()).thenReturn(allUsers);
        //Mockito.when(userRepository.findByOutcomeUserUserId(-99L).orElse(null)).thenReturn(null);
        */
    }

    //@Test
    public void compareModelMapperVsDTO() {
        String name = "alex";

        User u = makeRandomUser();

        UserDTO u1 = userService.convertToDto(u);
        UserDTO u2 = userService.modelMapperDTO(u);

        assertThat(u1.getUserId()).isEqualTo(u2.getUserId());
        assertThat(u1.getUsername()).isEqualTo(u2.getUsername());
        assertThat(u1.getFirstName()).isEqualTo(u2.getFirstName());
        assertThat(u1.getLastName()).isEqualTo(u2.getLastName());
        assertThat(u1.getLocale()).isEqualTo(u2.getLocale());
        assertThat(u1.getPictureUrl()).isEqualTo(u2.getPictureUrl());
    }

    //@Test
    public void whenValidUserName_thenUserShouldBeFound() {
        String name = "alex";
        List<UserDTO> founds = userService.findAll();
        UserDTO found = userService.findByUserName(name);

        assertThat(found.getUsername()).isEqualTo(name);
    }

    //@Test
    public void whenInValidName_thenUserShouldNotBeFound() {
        UserDTO fromDb = userService.findByUserName("wrong_name");
        assertThat(fromDb).isNull();

        verifyFindByUserNameIsCalledOnce("wrong_name");
    }

    //@Test
    public void whenValidName_thenUserShouldExist() {
        boolean doesUserExist = userService.exists("john");
        assertThat(doesUserExist).isEqualTo(true);

        verifyFindByUserNameIsCalledOnce("john");
    }

    //@Test
    public void whenNonExistingName_thenUserShouldNotExist() {
        boolean doesUserExist = userService.exists("some_name");
        assertThat(doesUserExist).isEqualTo(false);

        verifyFindByUserNameIsCalledOnce("some_name");
    }

    //@Test
    public void whenValidId_thenUserShouldBeFound() {
        UserDTO fromDb = userService.findByUserId(11L);
        assertThat(fromDb.getUsername()).isEqualTo("john");

        verifyFindByUserIdIsCalledOnce();
    }

    //@Test
    public void whenInValidId_thenUserShouldNotBeFound() {
        UserDTO fromDb = userService.findByExternalId(-99L + "");
        verifyFindByUserIdIsCalledOnce();
        assertThat(fromDb).isNull();
    }

    //@Test
    public void given3Users_whengetAll_thenReturn3Records() {
        UserDTO alex = new UserDTO("alex");
        UserDTO john = new UserDTO("john");
        UserDTO bob = new UserDTO("bob");

        List<UserDTO> allUsers = userService.findAll();
        verifyFindAllUsersIsCalledOnce();
        //assertThat(allUsers).hasSize(3).extracting(UserDTO::getUserName).contains(alex.getUserName(), john.getUserName(), bob.getUserName());
    }

    private void verifyFindByUserNameIsCalledOnce(String name) {
        Mockito.verify(userRepository, VerificationModeFactory.times(1)).findByUserName(name);
        Mockito.reset(userRepository);
    }

    private void verifyFindByUserIdIsCalledOnce() {
        Mockito.verify(userRepository, VerificationModeFactory.times(1)).findByUserId(Mockito.anyLong());
        Mockito.reset(userRepository);
    }

    private void verifyFindAllUsersIsCalledOnce() {
        Mockito.verify(userRepository, VerificationModeFactory.times(1)).findAll();
        Mockito.reset(userRepository);
    }

    private User makeRandomUser(){

        User u = new User();

        u.setUserId(new Random().nextLong());
        u.setUserName(UUID.randomUUID().toString());
        u.setProfilePictureUrl(UUID.randomUUID().toString());
        u.setLocale(UUID.randomUUID().toString());
        u.setEmail(UUID.randomUUID().toString());
        u.setExternalId(UUID.randomUUID().toString());
        u.setExternalIdProvider(UUID.randomUUID().toString());
        u.setPassword(UUID.randomUUID().toString());
        u.setPushId(UUID.randomUUID().toString());
        u.setLastName(UUID.randomUUID().toString());

        return u;
    }
}